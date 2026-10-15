#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen-icon-zh.py — 生成「按图标挂中文关键词」数据 data/icon-zh.json（方案 A）

数据形态：{ "图标名": ["中文词", ...], ... }，被打进插件 bundle，
运行时中文搜索直接匹配每图标的中文词（lib/icons.ts），不再绕全局词典。

生成策略（tag 冗余的优化落点）：
- 图标有 20+ 个英文 tag，但大量近义重复（network/networking、web/online）。
  因此不逐 tag 翻译，而是：现有手工词典 zh-dict.json 反推 —— 中文词 W 挂到
  图标 I，当且仅当 W 的英文值命中 I 的「名字分词」（优先）或官方 tag。
  即：name 是主信号，tag 只是语境参考。
- 每图标按优先级保留至多 MAX_PER_ICON 个中文词（名字命中 > tag 命中，短词优先）。
- CURATED 为人工词表：反推覆盖不到或质量不佳的概念（如 齿轮→cog/settings），
  每次运行都合并进去，保证可重复执行、幂等。

用法：
    python3 scripts/gen-icon-zh.py            # 生成 + 打印缺口报告
    python3 scripts/gen-icon-zh.py --check    # 只打印缺口报告，不写文件

后续维护：npm run sync:icons 之后跑本脚本；报告里「无中文词」的图标
需要人工在 CURATED 补词（或直接编辑 data/icon-zh.json）。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "data", "lucide-icons.json")
ZH_DICT = os.path.join(ROOT, "data", "zh-dict.json")
OUT = os.path.join(ROOT, "data", "icon-zh.json")

MAX_PER_ICON = 8

# off/mute 类通用词：不算词族核心，变体继承本体词时剔除（与 audit-zh.py 保持同一份口径）
GENERIC_ZH = {"关闭", "电源", "静音", "禁用", "开关", "勿扰", "隐藏", "停用", "开启"}

# 人工词表：反推覆盖不到 / 需要更贴切说法的概念。key = 图标名，value = 追加的中文词。
# **永远置顶保留**（先于反推词，不受截断影响）。维护原则：只加「设计师会输入的词」，宁缺勿滥。
CURATED = {
    "cog": ["齿轮", "齿轮状"],
    "settings": ["齿轮"],
    "gear": ["齿轮"],
    "house": ["家", "住宅", "房子", "主页"],
    "globe-off": ["断网", "网络", "离线"],
    "wifi-off": ["断网", "无网络"],
    "home": ["家", "住宅"],
    "armchair": ["家具", "沙发"],
    "sofa": ["家具", "沙发"],
    "bed": ["家具"],
    "bed-double": ["家具"],
    "lamp": ["家具", "灯具"],
    "table": ["家具", "桌子"],
    "rocking-chair": ["家具"],
    "ethernet-port": ["网口", "以太网", "网络"],
    "router": ["路由器", "网络"],
    "wifi": ["网络", "无线"],
    "dna": ["基因", "脱氧核糖核酸"],
    "haze": ["雾霾", "薄雾"],
    "roller-coaster": ["过山车"],
    "axis-3d": ["三维坐标轴", "立体坐标"],
    "bath": ["洗澡", "浴室", "浴缸"],
    "biceps-flexed": ["肌肉", "手臂", "健美"],
    "captions": ["字幕"],
    "cigarette": ["香烟", "吸烟"],
    "copyright": ["版权"],
    "copyleft": ["著作权", "版权反转"],
    "mailbox": ["邮箱", "信箱"],
    "non-binary": ["非二元性别"],
    "shovel": ["铲子", "铁锹"],
    "shower-head": ["花洒", "淋浴"],
    "toilet": ["马桶", "厕所"],
    "toothbrush": ["牙刷"],
    "transgender": ["跨性别"],
    "venus": ["金星", "金星符号"],
}


# 剔除词表：反推时英文多义词串义项产生的噪声词（key = 图标名，value = 要去掉的词）。
# 例：radio-tower 的 tag「radio」把「单选」（radio button）带了进来。
CURATED_REMOVE = {
    "radio-tower": ["单选"],
    "satellite-dish": ["食物"],
    "hard-drive": ["施工", "安全帽"],
    "cable": ["雷达"],
    "usb": ["车辆"],
    "server": ["梦"],
    "server-off": ["梦"],
    "server-crash": ["梦"],
    # 「首页/返回首页」只属于 house（UI 首页按钮的图标）；家居类图标的
    # home tag 会把这个词串进来（lamp 的家用、robot-vacuum 的回家充电）
    "birdhouse": ["首页", "返回首页"],
    "caravan": ["首页", "返回首页"],
    "house-plug": ["首页", "返回首页"],
    "house-plus": ["首页", "返回首页"],
    "house-wifi": ["首页", "返回首页"],
    "lamp": ["首页", "返回首页"],
    "lamp-ceiling": ["首页", "返回首页"],
    "lamp-floor": ["首页", "返回首页"],
    "map-pin-house": ["首页", "返回首页"],
    "newspaper": ["首页", "返回首页"],
    "robot-vacuum": ["首页", "返回首页"],
}


def tokenize(s: str):
    return set(t for t in re.split(r"[-_\s]+", s.lower()) if t)


def main():
    check_only = "--check" in sys.argv
    d = json.load(open(DATASET, encoding="utf-8"))
    zh = json.load(open(ZH_DICT, encoding="utf-8"))
    names = d["names"]
    tag_dict = d["tagDict"]

    # 英文词 → 中文词（词典反推）
    en2zh = {}
    for zh_word, values in zh.items():
        for v in values:
            for t in tokenize(v):
                en2zh.setdefault(t, set()).add(zh_word)

    existing = {}
    if os.path.exists(OUT):
        existing = json.load(open(OUT, encoding="utf-8"))

    result = {}
    gaps = []
    for i, name in enumerate(names):
        # 多词 tag（如 'no connection'）也要拆词，否则错失否定系召回
        icon_tags: set = set()
        for t in d["tags"][i]:
            icon_tags |= tokenize(tag_dict[t])
        name_tokens = tokenize(name)
        # -off 后缀的『off』降到最低优先级：它只产通用词（关闭/电源/静音），
        # 会把本体词和 tag 语义词（网络/离线）挤出上限 —— globe-off 曾因此搜不到「网络」
        if name.endswith("-off"):
            name_tokens.discard("off")
            generic_tokens = {"off"}
        else:
            generic_tokens = set()

        by_pri = {}  # zh_word -> 优先级（0=名字命中，1=tag 命中）
        for token in name_tokens | icon_tags | generic_tokens:
            zh_words = en2zh.get(token)
            if not zh_words:
                continue
            if token in name_tokens:
                pri = 0
            elif token in generic_tokens:
                pri = 2
            else:
                pri = 1
            for w in zh_words:
                if pri < by_pri.get(w, 99):
                    by_pri[w] = pri

        gen = [w for w, _ in sorted(by_pri.items(), key=lambda kv: (kv[1], len(kv[0])))]
        # 优先级：人工词表 > 既有文件（历代人工成果） > 反推；统一截断到上限
        words: list = []
        for source in (CURATED.get(name, []), existing.get(name, []), gen):
            for w in source:
                if len(words) >= MAX_PER_ICON:
                    break
                if w not in words:
                    words.append(w)
        words = [w for w in words if w not in CURATED_REMOVE.get(name, [])]
        if not words:
            gaps.append(name)
        result[name] = words

    # 词族继承：-off / -slash 变体图标继承本体的核心词（剔除通用词后）。
    # 「服务器」只挂在 server 上时，server-off 会搜不到 —— 继承比逐个补 CURATED 可持续。
    # 顺序：CURATED > 继承词 > 其余（通用词自然被截断）。
    for name in list(result):
        base = re.sub(r"-(off|slash)$", "", name)
        if base == name or base not in result:
            continue
        inherit = [w for w in result[base] if w not in GENERIC_ZH and w not in result[name]]
        if inherit:
            words = result[name]
            curated_words = [w for w in words if w in CURATED.get(name, [])]
            rest = [w for w in words if w not in curated_words]
            result[name] = (curated_words + inherit + rest)[:MAX_PER_ICON]

    total_words = sum(len(v) for v in result.values())
    covered = len(result) - len(gaps)
    print(f"[gen-icon-zh] {covered}/{len(names)} 图标有中文词，共 {total_words} 个词"
          f"（平均 {total_words / max(len(names), 1):.1f} 词/图标）")

    if gaps:
        print(f"[gen-icon-zh] ⚠️ {len(gaps)} 个图标无中文词（需在 CURATED 补词）:")
        print("  " + ", ".join(gaps))

    if check_only:
        return

    raw = json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(raw)
    print(f"[gen-icon-zh] ✅ 生成 {os.path.relpath(OUT, ROOT)}（{len(raw.encode()) / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
