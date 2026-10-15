#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""audit-zh.py — 中文关键词四层审计（gen-icon-zh.py 的质检伴生脚本）

对 data/icon-zh.json 做四类检查，输出报告：
  A. 无词/少词图标        —— 覆盖广度
  B. 英文词位暗区          —— 名字/tag 里出现的英文词，词典翻译不出任何中文词
                             （齿轮类缺词的预警器：新图标/新 tag 一进来就能看到断点）
  C. 词族一致性            —— -off 图标应继承本体图标的核心词
                             （server-off 丢「服务器」、globe-off 丢「网络」都是这一类）
  D. 常用词回归测试        —— scripts/zh-queries.json 里的「搜索词 → 必须命中」断言
                             （本次会话踩过的坑固化为测试集，防改词表时回退）

退出码：D 层有失败 → 非零（可当 CI 门禁）；A/B/C 只报告不失败。

用法：python3 scripts/audit-zh.py   （npm run sync:icons 链尾自动跑）
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET = os.path.join(ROOT, "data", "lucide-icons.json")
ZH_DICT = os.path.join(ROOT, "data", "zh-dict.json")
ICON_ZH = os.path.join(ROOT, "data", "icon-zh.json")
QUERIES = os.path.join(ROOT, "scripts", "zh-queries.json")

MIN_WORDS = 3  # A 层：少于这个数算「少词」，提示人工看看

# off/mute 类通用词：不算词族核心，比对时剔除
GENERIC_ZH = {"关闭", "电源", "静音", "禁用", "开关", "勿扰", "隐藏", "停用", "开启"}


def tokenize(s: str):
    return set(t for t in re.split(r"[-_\s]+", s.lower()) if t)


def main():
    d = json.load(open(DATASET, encoding="utf-8"))
    zh = json.load(open(ZH_DICT, encoding="utf-8"))
    icon_zh = json.load(open(ICON_ZH, encoding="utf-8"))
    names = d["names"]
    tag_dict = d["tagDict"]

    en2zh = {}
    for zh_word, values in zh.items():
        for v in values:
            for t in tokenize(v):
                en2zh.setdefault(t, set()).add(zh_word)

    fail = False

    # ---- A. 无词/少词 ----
    thin = [(n, icon_zh.get(n, [])) for n in names if len(icon_zh.get(n, [])) < MIN_WORDS]
    print(f"\n[A] 少于 {MIN_WORDS} 个中文词的图标：{len(thin)} 个")
    for n, w in thin[:15]:
        print(f"    {n}: {w}")

    # ---- B. 英文词位暗区 ----
    token_icons = {}
    for i, name in enumerate(names):
        for t in tokenize(name):
            token_icons.setdefault(t, set()).add(i)
        for tid in d["tags"][i]:
            for t in tokenize(tag_dict[tid]):
                token_icons.setdefault(t, set()).add(i)
    dark = {t: s for t, s in token_icons.items() if len(t) >= 3 and t not in en2zh}
    dark_sorted = sorted(dark.items(), key=lambda kv: -len(kv[1]))
    print(f"\n[B] 英文词位暗区（词典翻译不出、影响 {len(dark_sorted)} 个词）：")
    for t, s in dark_sorted[:20]:
        print(f"    {t}（影响 {len(s)} 个图标）: {', '.join(names[i] for i in sorted(s)[:4])}")

    # ---- C. -off 词族一致性 ----
    family_gap = []
    for name in names:
        if not name.endswith("-off"):
            continue
        base = name[: -len("-off")]
        if base not in icon_zh:
            continue
        base_core = [w for w in icon_zh[base] if w not in GENERIC_ZH]
        off_words = set(icon_zh.get(name, []))
        missing = [w for w in base_core if w not in off_words]
        if missing:
            family_gap.append((name, base, missing))
    print(f"\n[C] -off 图标缺失本体核心词：{len(family_gap)} 个")
    for name, base, missing in family_gap[:15]:
        print(f"    {name} 缺 {base} 的词: {'、'.join(missing)}")

    # ---- D. 常用词回归测试 ----
    if os.path.exists(QUERIES):
        data = json.load(open(QUERIES, encoding="utf-8"))
        queries = data["cases"] if isinstance(data, dict) else data
        # 复刻 lib/icons.ts 的中文搜索：zh 倒排 + 双字以上子串匹配
        zh_to_indices = {}
        for i, name in enumerate(names):
            for w in icon_zh.get(name, []):
                zh_to_indices.setdefault(w, set()).add(i)
        misses = []
        for case in queries:
            q = case["q"]
            words = [k for k in zh_to_indices if k == q or (len(k) >= 2 and len(q) >= 2 and (k in q or q in k))]
            hits = set()
            for w in words:
                hits |= {names[i] for i in zh_to_indices[w]}
            for expect in case["expect"]:
                if expect not in hits:
                    misses.append((q, expect))
        print(f"\n[D] 常用词回归测试：{len(queries)} 个搜索词，{len(misses)} 个断言失败")
        for q, expect in misses:
            print(f"    ✗ 搜「{q}」未命中 {expect}")
            fail = True
    else:
        print("\n[D] 未找到 scripts/zh-queries.json，跳过回归测试")

    if fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
