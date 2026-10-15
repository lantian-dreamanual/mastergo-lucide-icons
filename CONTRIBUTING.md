# 贡献指南

感谢你愿意一起维护这个插件。它是纯前端项目（Vue 3 + TypeScript），改起来门槛不高——但下面「硬约束」里的每一条都是踩过坑才定下来的，**改代码前请先读一遍**。

## 环境

- Node.js 22（开发时使用的版本）
- Python 3.10+（只有重新拉取图标数据时才需要）

```bash
npm install          # 使用 npm；仓库不含 yarn.lock，CI 用 npm ci
npm run typecheck    # 类型检查（基于 tsconfig.check.json，只覆盖 lib/ 与 messages/）
npm run build        # 产出 dist/
npm run dev          # 双 watch（UI + 主线程）
```

在 MasterGo 客户端里调试：

1. 插件 → 开发者模式 → 创建/添加插件 → 上传 `manifest.json`
2. 构建后通过插件菜单运行

重跑最近插件快捷键：macOS `Cmd + Option + P`。

## 项目结构

```
Lucide 图标库/
├── manifest.json            # 插件清单
├── package.json             # 构建脚本与依赖
├── vite.config.ts           # 构建配置（singlefile + vue）
├── tsconfig.json / tsconfig.check.json
├── index.html               # UI 入口
├── LICENSE                  # 本插件代码的许可（MIT）
├── README.md                # 对外说明（功能、安装、使用）
├── THIRD-PARTY-NOTICES.md   # 内置数据的三方许可声明（Lucide ISC / Feather MIT）
├── .github/workflows/ci.yml # CI：类型检查 + 构建 + 产物校验
├── lib/
│   ├── main.ts              # 主线程：drop 监听 + 建节点 + 后处理 + clientStorage 读写
│   ├── icons.ts             # 数据加载 + 索引 + 搜索（名字 / tag / 分类 / 别名 / 中文）
│   ├── store.ts             # 样式与界面状态的类型 / 默认值 / 归一化（纯逻辑，不做 I/O）
│   ├── svg.ts               # Lucide → SVG 字符串（绝对描边公式 + 色值 / 数值校验）
│   └── mg-drop.ts           # drop 事件类型补齐层
├── messages/
│   └── sender.ts            # UI ↔ 主线程消息协议
├── ui/
│   ├── App.vue              # 面板主组件（搜索 + 布局 + 导入反馈）
│   ├── ui.ts                # Vue 应用挂载
│   └── components/
│       ├── CategoryBar.vue  # 左侧固定竖栏分类（84px，纵向可滚动）
│       ├── StyleBar.vue     # 样式条（尺寸 / 描边 / 绝对描边 / 颜色），可折叠
│       └── IconGrid.vue     # 虚拟滚动网格（拖拽 + 点击）
├── data/
│   ├── lucide-icons.json    # 紧凑数据集（1847 图标 / 535KB）
│   ├── icon-zh.json         # 每图标中文关键词（方案 A，gen-icon-zh.py 生成，可人工增补）
│   ├── compressed.ts        # 构建期生成的 gzip+base64 数据（勿手编；已提交，CI typecheck 依赖它）
│   └── zh-dict.json         # 旧版中文词典（gen-icon-zh.py 的翻译素材源，已不进 bundle）
└── scripts/
    ├── sync-icons.py        # 数据同步脚本（固定 commit + 结构校验 + 离线通道）
    ├── gen-icon-zh.py       # 中文关键词生成（词典反推 + 人工词表，幂等可重复跑）
    └── compress-data.mjs    # 构建期把两个 JSON 压成 gzip+base64（npm run build 自动跑）
```

## 硬约束（不遵守会导致线上问题）

| # | 约束 | 原因 |
|---|---|---|
| 1 | **`build` 结束后 `dist/` 必须只有 `index.html` + `main.js`，且 HTML 里不含任何 `src=` / `href=` 外链** | 插件面板是 `origin: null` 的 iframe，外链资源加载不到；`vite-plugin-singlefile` 内联后仍会多吐一份 `assets/`，由 `clean:assets` 脚本删除 |
| 2 | **不能用 `satisfies`** | vite 2 内置 esbuild 0.14 不支持，改用 `const x: T = {...}` |
| 3 | **虚拟滚动的几何常量只能在 `ui/components/IconGrid.vue` 顶部定义一次**，高度 / 列数用 `:style` 下发 DOM，**CSS 里不要写回像素值** | 曾出现 TS 按行距 72 计算、CSS 实际是 62，导致网格底部常驻白屏。CSS 的 `:style` 也不要传字符串（走 `cssText` 赋值，兼容性不确定），用 `CSSProperties` 对象 |
| 4 | **改 `lib/store.ts` 的默认值，必须同时升 `STATE_KEY` 的版本号**（现为 `lucide-mastergo.state.v2`） | 用户已持久化的旧值会盖掉新默认值，表现为「改了没生效」 |
| 5 | **`lib/store.ts` 不做任何 I/O** | 持久化只能走主线程 `mg.clientStorage`（UI 是 data: URL iframe，浏览器会禁用其 Storage，访问 `localStorage` 直接抛 `DOMException`） |
| 6 | **`mg.on` / `mg.ui.onmessage` 的回调不能是 `async`** | 平台限制；异步逻辑在回调内部起 IIFE |
| 7 | **构建通过 ≠ 类型正确**，提交前务必跑 `npm run typecheck` | vite / esbuild 只剥类型不校验。曾有一处类型谓词（`is X` 形式）把调用处的分支收窄成 `never`，构建全绿但类型是错的 |
| 8 | **图标默认色只在一处定义**：`lib/svg.ts` 的 `DEFAULT_ICON_COLOR` 是静态兜底（主线程 / 测试用），UI 侧实际生效的是 `lib/store.ts` 的 `preferredIconColor()`（面板主题的反色）。**不要在两处各写一份字面量** | 兜底色若不跟随主题，深色面板下首次打开会是黑图标整片看不见；两处硬编码则改一处漏一处 |
| 9 | **`ui/App.vue` 的 `computed` 必须保持纯函数**，不要在 computed 里给 `ref` 赋值 | 会让依赖追踪变得不可预测，并可能在渲染期触发额外更新 |
| 10 | **`scripts/sync-icons.py` 结构校验失败必须非零退出**，且「网络错误」与「数据结构变更」要分两种文案 | 用 try-catch 吞掉会让 CI 与 `--check` 失去意义；文案混在一起会把排查方向带偏 |
| 11 | **拖拽落点直接用 `event.absoluteX` / `absoluteY` 换算，不要引入 `viewport.zoom`** | 落点公式是 `frame.x = absoluteX − frame.width / 2`；MasterGo 内部读 `positionOnDom` 完成换算。曾按 `viewport.zoom` 乘算，实测 0.684 被采样成 0.7，落点会偏 |

## 本地验证的边界

- **运行时行为必须在 MasterGo 客户端实机验收**（拖拽落点、导入反馈、持久化、嵌套排除等）。本地只能验证到「类型检查 + 构建产物 + 逻辑仿真」三层
- `mg.clientStorage` 不可用时会退回会话内存储（不跨会话），仅在 console 给出警告

## 更新图标数据（维护者流程）

这是**手动流程**，插件不做运行时自动更新：

```bash
npm run sync:icons   # 1) 重新生成数据集 + 中文关键词（gen-icon-zh.py 已挂链尾）
npm run build        # 2) 重新构建（构建期自动压缩数据为 gzip+base64，即 data/compressed.ts）
                     # 3) 到 MasterGo 客户端重新上传插件
```

数据更新后 `data/compressed.ts` 会随之变化，**记得一并提交**（CI 的 typecheck 依赖它存在）。

同步脚本的几种用法：

```bash
npm run sync:icons                                        # 从 GitHub 取最新 main
python3 scripts/sync-icons.py --sha=<sha> [--date=<iso>]  # 指定版本，跳过 GitHub API
python3 scripts/sync-icons.py --from-tarball=x.tar.gz     # 用本地 tarball（弱网 / 断流时）
python3 scripts/sync-icons.py --check                     # 只看现有产物版本，不联网
```

注意事项：

- GitHub API 匿名限流 60 次/小时。限流时 `codeload` 下载不受影响，所以「`curl -L -C -` 下 tarball + `--sha` 指定版本」是限流期间的可靠组合
- `codeload` 的大 tarball 可能断流；脚本内置重试，仍失败就走 `--from-tarball` 离线通道
- 数据集里的分类与 tag 来自每个图标的元数据（`icons/<name>.json`），不是 `categories/*.json`——后者只有分类标题与代表图标
- 提交数据集更新时请**单独一个 PR**，说明上游 commit SHA
- 中文搜索关键词在 `data/icon-zh.json`（图标名 → 中文词数组，每图标至多 5 个）。`npm run sync:icons` 会自动重跑 `gen-icon-zh.py`：新图标由词典反推自动获得中文词，报告里「无中文词」的图标需要在 `scripts/gen-icon-zh.py` 的 `CURATED` 词表补词后重跑。高频搜索词（如「齿轮」「网口」）直接编辑 `icon-zh.json` 或加进 `CURATED`，不会被覆盖

## 提交 PR

- 一个 PR 只解决一件事，说明**改动动机**与**验证方式**（跑了什么命令、观察到什么结果）
- 改动了 UI 就附截图
- 不要在功能 PR 里夹带数据集更新

## 说明

维护者是业余时间维护，不承诺响应时限。Issue 和 PR 都会看，但不一定及时——请以 `main` 分支的实际状态为准。
