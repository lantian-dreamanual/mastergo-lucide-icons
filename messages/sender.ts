// 插件发出的消息
export enum PluginMessage {
  /** 主线程回传的一次导入结果（含落点/来源/是否成功） */
  INSERT_RESULT = 'insert-result',
  /** 主线程侧捕获到的异常 */
  ERROR = 'error',
  /** 回应 LOAD_STATE：带回上次持久化的状态（从未存过则为 null） */
  STATE_LOADED = 'state-loaded',
}

// UI 发出的消息
export enum UIMessage {
  /**
   * 导入单个图标。
   * 分两种来源：
   *  - source = 'drag'：UI 侧在 dragend 时 postMessage(pluginDrop)，主线程 drop 事件收到 absoluteX/absoluteY，
   *    几何中心对齐落点（PRD F3.1）；
   *  - source = 'click'：不带坐标，主线程按 F3.2 决定落点（无选中 → 视口中心；选中容器 → 容器内居中）。
   */
  INSERT_ICON = 'insert-icon',
  /** 面板启动时请求上次持久化的样式与界面状态（F3.4） */
  LOAD_STATE = 'load-state',
  /** 样式/界面状态变化，请求落盘（F3.4） */
  SAVE_STATE = 'save-state',
}

type MessageType = {
  type: UIMessage | PluginMessage
  data?: unknown
}

/** 一条导入请求的载荷（UI 打包进 dropMetadata / onmessage data） */
export interface InsertRequest {
  /** 图标名（图层重命名依据，F3.3 ①） */
  name: string
  /** 渲染所需的 SVG 节点数组，与 lib/svg.ts 的 IconNode 对齐 */
  nodes: IconNodeLike[]
  size: number
  strokeWidth: number
  color: string
  absoluteStrokeWidth: boolean
  /** 点击插入时使用的来源标记 */
  source: 'drag' | 'click'
}

/** 兼容 lib/svg.ts 的 IconNode 结构（UI 侧引入 buildSvg 的类型） */
export type IconNodeLike = [string, Record<string, string | number>]

/** 主线程回传的单次导入结果 */
export interface InsertResult {
  ok: boolean
  name: string
  source: 'drag' | 'click'
  elapsed: number
  imported: { width: number; height: number } | null
  /**
   * 用户可读的失败原因（ok=false 时有值），直接展示在面板 toast 里。
   * 措辞要求：说清「哪个图标 + 怎么办」，不要直接把异常堆栈丢给用户。
   */
  error?: string
  /** 原始异常文本，仅用于排查，UI 只写 console 不外显 */
  errorDetail?: string
  /** 落点：drag 来自 drop 事件；click 来自 F3.2 决策 */
  drop: {
    x: number | null
    y: number | null
    absoluteX: number | null
    absoluteY: number | null
  }
}

/** 回应 LOAD_STATE 的载荷 */
export interface StateLoadedPayload {
  /** 上次持久化的原始状态；从未存过或读取失败时为 null */
  state: unknown
}

/** 向 UI 发送消息 */
export const sendMsgToUI = (data: MessageType) => {
  mg.ui.postMessage(data, '*')
}

/** 向插件发送消息 */
export const sendMsgToPlugin = (data: MessageType) => {
  parent.postMessage(data, '*')
}
