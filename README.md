# Lucide 图标库 · MasterGo 插件

> 在 MasterGo 面板里，用和前端代码完全同名的方式找到 Lucide 图标，按设计规范调好尺寸与描边，拖到画布上——拿到的是一份可继续编辑的矢量图层，而不是一张图。

## 核心特性

- **与代码同名**：搜索框里输入 `house`，拿到的就是代码里 `<House />` 渲染的那个图标
- **绝对描边宽度**：公式 `strokeWidth × 24 / size`，与 lucide.dev 及源码逐字对齐，改尺寸不改变描边视觉粗细
- **官方分类 + 官方 tag**：沿用 Lucide 42 分类与 4000+ 官方 tag；同时并入 264 个官方旧名（命中时提示「已改名为 xxx」）
- **中文可搜**：内置词典（1806 条），输入「设置」也能搜到 `settings`；分类栏优先显示中文
- **矢量可编辑**：拖入画布后是真实的矢量图层树，描边色、图层名均可编辑
- **默认色跟着主题走**：面板是深色底时默认描边色取白、浅色底时取黑，打开就能看清，不会被同色底吃掉
- **离线内置**：1847 个图标全量离线内置，零网络请求
- **参数记忆**：尺寸 / 描边 / 颜色 / 所在分类 / 样式条折叠状态跨会话保留

## 快速开始

### 构建插件

```bash
npm install
npm run build
```

构建产物在 `dist/` 下，包含 `index.html`（UI）和 `main.js`（主线程），均为单文件内联。

### 在 MasterGo 中调试

1. 打开 MasterGo 客户端
2. 插件 → 开发者模式 → 创建/添加插件 → 上传 `manifest.json`
3. 构建后通过插件菜单运行

重跑最近插件：macOS `Cmd + Option + P`。

### 更新图标库数据

**本插件不做运行时自动更新**——不联网检查新版本、不提示更新。图标库更新由维护者手动执行：

```bash
# 1) 重新生成数据集
npm run sync:icons

# 2) 重新构建
npm run build

# 3) 重新上传 manifest.json 指向的插件（MasterGo 客户端 → 开发者模式）
```

数据同步脚本的几种用法：

```bash
npm run sync:icons                                      # 从 GitHub 取最新 main
python3 scripts/sync-icons.py --sha=<sha> [--date=<iso>]  # 指定版本，跳过 GitHub API（API 限流时用）
python3 scripts/sync-icons.py --from-tarball=x.tar.gz     # 用本地 tarball（弱网/断流时）
python3 scripts/sync-icons.py --check                     # 只看现有产物版本，不联网
```

> GitHub API 匿名限流 60 次/小时。限流时 `codeload` 下载不受影响，所以「`curl -L -C -` 下 tarball + `--sha` 指定版本」是限流期间的可靠组合。

## 项目结构

```
Lucide 图标库/
├── manifest.json           # 插件清单
├── package.json            # 构建脚本与依赖
├── vite.config.ts          # 构建配置（singlefile + vue）
├── tsconfig.json / tsconfig.check.json
├── index.html              # UI 入口
├── lib/
│   ├── main.ts             # 主线程：drop 监听 + 建节点 + 后处理 + clientStorage 读写
│   ├── icons.ts            # 数据加载 + 索引 + 搜索（名字/tag/分类/别名/中文）
│   ├── store.ts            # 样式与界面状态的类型/默认值/归一化（纯逻辑，不做 I/O）
│   ├── svg.ts              # Lucide → SVG 字符串（绝对描边公式 + 色值/数值校验）
│   └── mg-drop.ts          # drop 事件类型补齐层
├── messages/
│   └── sender.ts           # UI ↔ 主线程消息协议
├── ui/
│   ├── App.vue             # 图标面板主组件（搜索 + 布局 + 导入反馈）
│   ├── ui.ts               # Vue 应用挂载
│   └── components/
│       ├── CategoryBar.vue  # 左侧固定竖栏分类（84px，纵向可滚动）
│       ├── StyleBar.vue     # 样式条（尺寸/描边/绝对描边/颜色）可折叠
│       └── IconGrid.vue     # 虚拟滚动网格（拖拽 + 点击）
├── data/
│   ├── lucide-icons.json   # 紧凑数据集（1847 图标 / 535KB）
│   └── zh-dict.json        # 中文搜索词典（人工可增补，不被 sync 覆盖）
└── scripts/
    └── sync-icons.py       # 数据同步脚本（固定 commit + 结构校验 + 离线通道）
```

## 构建约束

- 包管理用 npm（本机无 yarn）
- TS 代码不能用 `satisfies`（vite 2 内置 esbuild 0.14 不认）
- 类型检查用 `npm run typecheck`（基于 `tsconfig.check.json`，只覆盖 `lib/` 与 `messages/`）
- 构建后 `dist/` 只剩 `index.html` + `main.js`，无 `src=`/`href=` 外链
- `mg.on` 回调不能是 async，异步逻辑内部起 IIFE

## 几处易错点（改动前先读）

| 位置 | 约束 |
|---|---|
| `ui/components/IconGrid.vue` | **几何常量（列数/格子高/间距/内边距）只允许在该文件顶部定义一次**，CSS 里不要写回像素值。历史上 TS 按 72 算行距、CSS 实际是 62，导致网格底部白屏 |
| `lib/store.ts` | 不做任何 I/O。持久化走主线程的 `mg.clientStorage`——插件 UI 是 data: URL iframe，`localStorage` 被浏览器禁用。**改默认值时必须一并升 `STATE_KEY` 的版本号**（现为 `lucide-mastergo.state.v2`），否则用户上次存下的旧值会把新默认值盖掉，改了等于没改 |
| `lib/svg.ts` | `DEFAULT_ICON_COLOR` 是静态兜底；UI 侧真正生效的默认色是 `store.ts` 的 `preferredIconColor()`（面板主题的反色）。两处不要各写一份字面量 |
| `lib/main.ts` | 插件生成的节点要打 `pluginData` 标记，否则「自动选中」会让下一次点击插入嵌进上一个图标内部 |
| `ui/App.vue` | computed 必须保持纯函数，不要在 computed 里给 ref 赋值 |
| `scripts/sync-icons.py` | 结构校验失败必须非零退出，不要用 try-catch 吞掉。区分「网络错误」与「结构变更」两种提示 |

## 技术栈

- Vue 3.2 + TypeScript 5
- Vite 2.9 + vite-plugin-singlefile
- MasterGo Plugin API（`createNodeFromSvgAsync` / `on('drop')` / `clientStorage` / `commitUndo`）
- Lucide Icons（ISC 许可）

## 已知边界

- 分类栏当前为左侧固定竖栏（不折叠）；深色模式只跟随系统 `prefers-color-scheme`，MasterGo 客户端内部主题感知不到。**默认描边色会据此切换**（深色面板白 / 浅色面板黑）
- 该默认色同时也是写入画布的描边色——**浅色画布上插白图标会看不见**，用样式条的颜色选择器改一次即可（会持久化）
- `mg.clientStorage` 不可用时会退回会话内存储（不跨会话），仅 console 警告
- 运行时行为必须在 MasterGo 实机验收，本地只能验证到「类型检查 + 构建产物 + 逻辑仿真」

## 许可证

MIT
