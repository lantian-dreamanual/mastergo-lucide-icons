# Lucide 图标库 · MasterGo 插件

> 在 MasterGo 面板里，用和前端代码完全同名的方式找到 Lucide 图标，按设计规范调好尺寸与描边，拖到画布上——拿到的是一份可继续编辑的矢量图层，而不是一张图。

## 核心特性

- **与代码同名**：搜索框里输入 `house`，拿到的就是代码里 `<House />` 渲染的那个图标
- **绝对描边宽度**：公式 `strokeWidth × 24 / size`，与 lucide.dev 及源码逐字对齐，改尺寸不改变描边视觉粗细
- **官方分类 + 官方 tag**：沿用 Lucide 42 分类与 4000+ 官方 tag，保证搜得到
- **矢量可编辑**：拖入画布后是真实的矢量图层树，描边色、图层名均可编辑
- **离线内置**：1847 个图标全量离线内置，零网络请求

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

```bash
# 联网取最新 main 分支
npm run sync:icons

# 离线复跑（已有 tarball）
python3 scripts/sync-icons.py --from-tarball=x.tar.gz

# 只看现有产物版本
python3 scripts/sync-icons.py --check
```

## 项目结构

```
Lucide 图标库/
├── manifest.json           # 插件清单
├── package.json            # 构建脚本与依赖
├── vite.config.ts          # 构建配置（singlefile + vue）
├── tsconfig.json / tsconfig.check.json
├── index.html              # UI 入口
├── lib/
│   ├── main.ts             # 主线程：drop 监听 + 建节点 + 后处理
│   ├── icons.ts            # 数据加载 + 索引 + 搜索
│   ├── store.ts            # 样式参数 + localStorage 持久化
│   ├── svg.ts              # Lucide → SVG 字符串（含绝对描边公式）
│   └── mg-drop.ts          # drop 事件类型补齐层
├── messages/
│   └── sender.ts           # UI ↔ 主线程消息协议
├── ui/
│   ├── App.vue             # 图标面板主组件
│   ├── ui.ts               # Vue 应用挂载
│   └── components/
│       ├── CategoryBar.vue  # 42 分类横滑 + 收起
│       ├── StyleBar.vue     # 样式条（尺寸/描边/绝对描边/颜色）可折叠
│       └── IconGrid.vue     # 虚拟滚动网格（拖拽 + 点击）
├── data/
│   └── lucide-icons.json   # 紧凑数据集（1847 图标 / 535KB）
└── scripts/
    └── sync-icons.py       # 数据同步脚本（含结构校验）
```

## 构建约束

- 包管理用 npm（本机无 yarn）
- TS 代码不能用 `satisfies`（vite 2 内置 esbuild 0.14 不认）
- 类型检查用 `npm run typecheck`（基于 `tsconfig.check.json`）
- 构建后 `dist/` 只剩 `index.html` + `main.js`，无 `src=`/`href=` 外链
- `mg.on` 回调不能是 async，异步逻辑内部起 IIFE

## 技术栈

- Vue 3.2 + TypeScript 5
- Vite 2.9 + vite-plugin-singlefile
- MasterGo Plugin API
- Lucide Icons（ISC 许可）

## 许可证

MIT
