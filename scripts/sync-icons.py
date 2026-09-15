#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync-icons.py — Lucide 图标数据同步（PRD F4.1 / F4.2 / F4.3）

从 lucide-icons/lucide 仓库拉取全量图标数据，生成紧凑数据集 data/lucide-icons.json。

设计要点（均来自实测，勿改）：
- 取数走 GitHub codeload tarball，一次请求拿全（5.2MB / ~3s）。
  不要改用 raw.githubusercontent.com（限速）或 jsdelivr 目录列表 API（会截断）。
- 先通过 GitHub API 固定 commit SHA，再下载该 SHA 的 tarball —— 版本可复现。
- 分类与 tags 的真身在每个图标的元数据 icons/<name>.json（categories/*.json 只有标题）。
- 结构校验失败必须非零退出（PRD F4.3），绝不静默产出残缺数据集。

用法：
    python3 scripts/sync-icons.py                        # 同步到最新 main
    python3 scripts/sync-icons.py --sha=<sha> [--date=<iso>]
                                                         # 指定版本，跳过 GitHub API
                                                         # （API 限流时用这个）
    python3 scripts/sync-icons.py --from-tarball=<path>  # 离线：用本地 tarball（版本号仍查 API）
    python3 scripts/sync-icons.py --sha=<sha> --from-tarball=<path> [--date=<iso>]
                                                         # 完全离线：自带版本号，不发任何请求
    python3 scripts/sync-icons.py --check                # 只校验现有产物，不联网

注：GitHub API 有匿名限流（60 次/小时），限流时 403。codeload 下载不受影响，
    所以「curl 下 tarball + --sha 指定版本」是限流期间的可靠组合。
"""

import http.client
import io
import json
import os
import re
import sys
import tarfile
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

REPO = "lucide-icons/lucide"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "data", "lucide-icons.json")

# 结构合理性硬阈值（2026-09-14 实测基线：1837 图标 / 42 分类 / tags 覆盖 100%）
MIN_ICONS, MAX_ICONS = 1000, 5000
MIN_CATEGORIES = 30
MIN_TAGS_COVERAGE = 0.95  # 有 tags 的图标占比
MIN_CATS_COVERAGE = 0.95  # 有 categories 的图标占比

SVG_TAG_RE = re.compile(r"<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)/?>")
ATTR_RE = re.compile(r'([a-zA-Z-]+)="([^"]*)"')
GEOM_ATTRS = ("d", "cx", "cy", "r", "x", "y", "width", "height",
              "x1", "y1", "x2", "y2", "points", "rx", "ry")


def die(msg: str, hint: str = ""):
    """网络/环境类致命错误（与结构校验失败区分开，避免误导）。"""
    print(f"\n[sync-icons] 错误：{msg}", file=sys.stderr)
    if hint:
        print(f"[sync-icons] {hint}", file=sys.stderr)
    sys.exit(1)


def fetch(url: str, attempts: int = 3) -> bytes:
    """带重试的 GET。codeload 大文件易断流（IncompleteRead），必须重试。"""
    last = None
    for i in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "lucide-mastergo-sync"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError,
                http.client.IncompleteRead, OSError) as e:
            last = e
            print(f"[sync-icons] 网络请求失败（第 {i}/{attempts} 次）：{e}", file=sys.stderr)
            if i < attempts:
                time.sleep(3)
    die(
        f"网络请求重试 {attempts} 次仍失败：{last}",
        "这是网络问题，不是上游结构变更。若为 GitHub API 403 限流，请改用 "
        "`--sha=<sha>` 指定版本以跳过 API；大文件断流可先用 "
        "`curl -L -C - --retry 3 <tarball-url> -o x.tar.gz` 下载后配 `--from-tarball=x.tar.gz`。",
    )


def parse_svg(svg_text: str):
    """Lucide SVG → 节点数组 [[tag, attrs], ...]。与 lib/svg.ts 的消费格式对齐。"""
    nodes = []
    for m in SVG_TAG_RE.finditer(svg_text):
        tag, raw = m.group(1), m.group(2)
        attrs = {}
        for am in ATTR_RE.finditer(raw):
            k, v = am.group(1), am.group(2)
            if k in GEOM_ATTRS:
                try:
                    v = float(v) if ("." in v or v.isdigit()) else v
                except ValueError:
                    pass
                attrs[k] = v
        nodes.append([tag, attrs])
    return nodes


def fail_structure(msg: str):
    print(f"\n[sync-icons] 结构校验失败：{msg}", file=sys.stderr)
    print("[sync-icons] 上游结构可能已变更（参见 PRD F4.3 / 风险 R4），禁止生成残缺数据集。", file=sys.stderr)
    sys.exit(1)


def download_and_parse(tarball_path=None, sha_arg=None, date_arg=None):
    # 1. 固定版本：先拿 main 的 commit SHA，再下该 SHA 的 tarball（可复现，PRD F4.2）
    if sha_arg:
        # GitHub API 匿名限流 60 次/小时，限流期间用 --sha 直接指定版本
        sha = sha_arg.strip()
        short = sha[:7]
        date = (date_arg or "").strip()
        print(f"[sync-icons] 指定版本 {short}（{date or '未提供日期'}）")
    else:
        try:
            commit = json.loads(fetch(f"https://api.github.com/repos/{REPO}/commits/main"))
        except (urllib.error.URLError, OSError) as e:
            die(
                f"无法访问 GitHub API：{e}",
                "若为 403 限流，请改用 `--sha=<sha> [--date=<iso>]` 指定版本后重跑。",
            )
        sha = commit["sha"]
        short = sha[:7]
        date = commit["commit"]["committer"]["date"]
        print(f"[sync-icons] 上游版本 main@{short}（{date}）")

    if tarball_path:
        print(f"[sync-icons] 使用本地 tarball：{tarball_path}")
        with open(tarball_path, "rb") as f:
            raw = f.read()
    else:
        print("[sync-icons] 下载 tarball ...")
        raw = fetch(f"https://codeload.github.com/{REPO}/tar.gz/{sha}")
    print(f"[sync-icons] tarball {len(raw) / 1024 / 1024:.1f} MB")

    svgs, metas, cat_titles = {}, {}, {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
        for member in tf:
            if not member.isfile():
                continue
            parts = member.name.split("/")
            if len(parts) < 3:
                continue
            top, fname = parts[1], parts[-1]
            is_svg = top == "icons" and fname.endswith(".svg")
            is_meta = top == "icons" and fname.endswith(".json")
            is_cat = top == "categories" and fname.endswith(".json")
            if not (is_svg or is_meta or is_cat):
                continue  # tarball 内混有 png 等二进制文件，只取关心的扩展名
            content = tf.extractfile(member).read().decode("utf-8")
            if is_svg:
                svgs[fname[:-4]] = content
            elif is_meta:
                metas[fname[:-5]] = json.loads(content)
            elif is_cat:
                cat_titles[fname[:-5]] = json.loads(content)
    return {"sha": sha, "short": short, "date": date}, svgs, metas, cat_titles


def build_dataset(version, svgs, metas, cat_titles):
    # ---- 结构校验（F4.3：显式失败）----
    if not (MIN_ICONS <= len(svgs) <= MAX_ICONS):
        fail_structure(f"图标数 {len(svgs)} 超出合理区间 [{MIN_ICONS}, {MAX_ICONS}]")
    if len(svgs) != len(metas):
        fail_structure(f"svg 数 {len(svgs)} 与元数据 json 数 {len(metas)} 不一致")
    if len(cat_titles) < MIN_CATEGORIES:
        fail_structure(f"分类标题文件仅 {len(cat_titles)} 个（阈值 {MIN_CATEGORIES}），categories 结构可能已变更")
    bad_meta = [n for n, m in metas.items() if not isinstance(m, dict)
                or "tags" not in m or "categories" not in m]
    if bad_meta:
        fail_structure(f"以下图标元数据缺少 tags/categories 键（结构已变更）：{bad_meta[:5]} ...")
    orphan_cats = {c for m in metas.values() for c in (m.get("categories") or [])} - set(cat_titles)
    if orphan_cats:
        fail_structure(f"元数据引用了没有标题文件的分类：{sorted(orphan_cats)}")

    # ---- 组装 ----
    tag_dict, tag_idx = [], {}
    cat_ids, cat_idx = [], {}
    names, nodes_all, tags_all, cats_all = [], [], [], []
    aliases = {}
    no_tags, no_cats = 0, 0

    for name in sorted(svgs):
        meta = metas[name]
        tags = meta.get("tags") or []
        cats = meta.get("categories") or []
        if not tags:
            no_tags += 1
        if not cats:
            no_cats += 1
        for a in meta.get("aliases") or []:
            aliases[a["name"]] = name

        ns = parse_svg(svgs[name])
        if not ns:
            fail_structure(f"图标 {name} 解析不到任何图形节点")

        tids = []
        for t in tags:
            if t not in tag_idx:
                tag_idx[t] = len(tag_dict)
                tag_dict.append(t)
            tids.append(tag_idx[t])
        cids = []
        for c in cats:
            if c not in cat_idx:
                cat_idx[c] = len(cat_ids)
                cat_ids.append(c)
            cids.append(cat_idx[c])

        names.append(name)
        nodes_all.append(ns)
        tags_all.append(tids)
        cats_all.append(cids)

    n = len(names)
    if no_tags / n > 1 - MIN_TAGS_COVERAGE:
        fail_structure(f"tags 覆盖率 {1 - no_tags / n:.1%} 低于阈值 {MIN_TAGS_COVERAGE:.0%}")
    if no_cats / n > 1 - MIN_CATS_COVERAGE:
        fail_structure(f"categories 覆盖率 {1 - no_cats / n:.1%} 低于阈值 {MIN_CATS_COVERAGE:.0%}")

    dataset = {
        "version": {
            "sha": version["short"], "fullSha": version["sha"], "upstreamDate": version["date"],
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "generator": "scripts/sync-icons.py",
        },
        "count": n,
        "names": names,
        "nodes": nodes_all,
        "tagDict": tag_dict,
        "tags": tags_all,
        "catList": [{"id": c, "title": cat_titles[c].get("title")} for c in cat_ids],
        "cats": cats_all,
        "aliases": aliases,  # 官方旧名 → 现名（PRD F1.3：命中旧名提示已改名）
    }
    return dataset


def write_out(dataset):
    raw = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(raw)
    os.replace(tmp, OUT_PATH)
    return raw


def main():
    if "--check" in sys.argv:
        if not os.path.exists(OUT_PATH):
            print("[sync-icons] --check：data/lucide-icons.json 不存在", file=sys.stderr)
            sys.exit(1)
        d = json.load(open(OUT_PATH, encoding="utf-8"))
        v = d.get("version", {})
        print(f"[sync-icons] 现有产物：{d['count']} 图标 / {len(d['tagDict'])} tags / "
              f"{len(d['catList'])} 分类 / {len(d.get('aliases', {}))} aliases · {v.get('sha')}（{v.get('generatedAt')}）")
        return

    tarball = None
    sha_arg = None
    date_arg = None
    known = ("--from-tarball=", "--sha=", "--date=")
    for a in sys.argv[1:]:
        if a.startswith("--from-tarball="):
            tarball = a.split("=", 1)[1]
        elif a.startswith("--sha="):
            sha_arg = a.split("=", 1)[1]
        elif a.startswith("--date="):
            date_arg = a.split("=", 1)[1]
        elif a.startswith("--") and not a.startswith(known):
            # 防止把 --shas=xxx 这类拼写错误静默忽略、又去撞限流的 API
            print(f"[sync-icons] 警告：未识别的参数 {a}（已忽略）", file=sys.stderr)
    version, svgs, metas, cat_titles = download_and_parse(tarball, sha_arg, date_arg)
    dataset = build_dataset(version, svgs, metas, cat_titles)
    raw = write_out(dataset)

    size_kb = len(raw.encode()) / 1024
    print(f"[sync-icons] ✅ 生成 {os.path.relpath(OUT_PATH, ROOT)}")
    print(f"[sync-icons]    {dataset['count']} 图标 / {len(dataset['tagDict'])} tag 词 / "
          f"{len(dataset['catList'])} 分类 / {len(dataset['aliases'])} aliases")
    print(f"[sync-icons]    体积 {size_kb:.0f} KB（PRD 预算 800KB 含代码）")
    print(f"[sync-icons]    版本 {dataset['version']['sha']}（{dataset['version']['generatedAt']}）")


if __name__ == "__main__":
    main()
