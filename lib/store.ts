/**
 * 样式参数与界面状态的「类型 + 默认值 + 校验」层（PRD F2.7 / F3.4）。
 *
 * 本文件是纯逻辑，不做任何 I/O、不依赖 mg，UI 与主线程都可安全引入。
 *
 * ## 为什么持久化不在这里做
 * MasterGo 插件 UI 跑在 data: URL 的 iframe 里，浏览器会**禁用其 Storage**
 * （访问 localStorage 直接抛 DOMException）。之前这里用「localStorage 不可用就
 * 降级内存 Map」兜底，结果是连「关掉面板再打开」都保不住 —— F3.4 等于完全没生效。
 *
 * 正解是走主线程的 `mg.clientStorage`（getAsync / setAsync，见 lib/main.ts），
 * 由 UI 通过消息协议读写。因此：
 *   - 本文件只负责「什么值是合法的」
 *   - 存取走 messages/sender.ts 的 LOAD_STATE / SAVE_STATE / STATE_LOADED
 */

import { DEFAULT_ICON_COLOR, normalizeColor } from './svg'
export { normalizeColor }
export { DEFAULT_ICON_COLOR }

export interface StyleState {
  /** 图标输出尺寸（px） */
  size: number
  /** 用户设定的描边粗细 */
  strokeWidth: number
  /** 绝对描边宽度（公式 strokeWidth × 24 / size） */
  absoluteStrokeWidth: boolean
  /** 描边色，只接受 #rgb / #rrggbb */
  color: string
}

export interface UiState {
  /** 上次所在分类 id（'all' = 全部） */
  category: string
  /** 样式条是否折叠（F2.7） */
  styleBarCollapsed: boolean
}

/** 一次持久化的完整状态：单 key 存盘，一次消息往返读写 */
export interface PersistedState {
  style: StyleState
  ui: UiState
}

/**
 * 主线程 clientStorage 里使用的 key。
 *
 * ⚠️ 末尾的 `.v2` 是**有意的存储版本号**，不是随手加的后缀。2026-09-15 把图标默认色
 *    从 `#000000` 改成 `#ffffff`（深色面板下黑图标整片看不见）时，如果沿用旧 key，
 *    用户上次存进去的 `color: '#000000'` 会盖掉新默认值 —— 改了等于没改。
 *    换 key 让旧状态自然失效，是一次性迁移；代价只是分类/尺寸等偏好重置一次。
 *    **再改默认值时请一并升版本号**，否则同样会被旧数据挡掉。
 */
export const STATE_KEY = 'lucide-mastergo.state.v2'

export const DEFAULT_STYLE: StyleState = {
  size: 24,
  strokeWidth: 2,
  absoluteStrokeWidth: false,
  /**
   * 静态兜底默认色。UI 侧实际使用的是 `preferredIconColor()`（按面板主题给白/黑）——
   * 这个常量只在拿不到主题信息时生效（主线程、测试）。理由见 svg.ts 的 DEFAULT_ICON_COLOR。
   */
  color: DEFAULT_ICON_COLOR,
}

export const DEFAULT_UI: UiState = {
  category: 'all',
  styleBarCollapsed: false,
}

/**
 * 面板是否正处于深色（判据与 App.vue 的 `@media (prefers-color-scheme: dark)` 同一套）。
 *
 * ⚠️ 只在 UI 侧调用。主线程沙箱里没有可靠的 `window.matchMedia`，
 *    因此主线程一律用静态默认值，不要把这个函数引到 lib/main.ts 里。
 */
export function prefersDarkUi(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 图标默认色 = 面板背景的反色，保证「打开就能看清」。
 *
 * 深色面板配黑图标会整片看不见（用户 2026-09-15 反馈的原始问题），
 * 而在浅色面板上硬写白色则会复现同一个问题 —— 所以默认值必须跟着主题走。
 */
export function preferredIconColor(): string {
  return prefersDarkUi() ? '#ffffff' : '#000000'
}

/** 尺寸滑块范围（必须与 StyleBar 里 input[type=range] 的 min/max 一致） */
export const SIZE_RANGE = { min: 16, max: 96 } as const
/** 描边滑块范围（同上） */
export const STROKE_RANGE = { min: 0.5, max: 6 } as const

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 任意来源（存储 / 消息载荷 / 脏数据）的样式对象 → 合法 StyleState。
 *
 * `fallbackColor` 用于「没存过 / 存坏了」的色值 —— UI 侧会传 `preferredIconColor()`，
 * 于是首次打开面板时的默认色就是当前主题的反色。
 */
export function sanitizeStyle(
  raw: unknown,
  fallbackColor: string = DEFAULT_STYLE.color
): StyleState {
  const r = (raw ?? {}) as Partial<StyleState>
  return {
    size: round2(clampNumber(r.size, SIZE_RANGE.min, SIZE_RANGE.max, DEFAULT_STYLE.size)),
    strokeWidth: round2(
      clampNumber(r.strokeWidth, STROKE_RANGE.min, STROKE_RANGE.max, DEFAULT_STYLE.strokeWidth)
    ),
    absoluteStrokeWidth:
      typeof r.absoluteStrokeWidth === 'boolean'
        ? r.absoluteStrokeWidth
        : DEFAULT_STYLE.absoluteStrokeWidth,
    color: normalizeColor(r.color, fallbackColor),
  }
}

/**
 * 任意来源的界面状态 → 合法 UiState。
 *
 * `validCategoryIds` 用于校验上次所在的分类是否还存在 —— 上游删除分类后，
 * 存着一个不存在的 id 会让面板打开就是空白（`catToIndices` 查不到 → 0 个图标），
 * 用户会以为插件坏了。
 */
export function sanitizeUi(raw: unknown, validCategoryIds: string[]): UiState {
  const r = (raw ?? {}) as Partial<UiState>
  const category = typeof r.category === 'string' ? r.category : ''
  return {
    category: validCategoryIds.includes(category) ? category : DEFAULT_UI.category,
    styleBarCollapsed:
      typeof r.styleBarCollapsed === 'boolean'
        ? r.styleBarCollapsed
        : DEFAULT_UI.styleBarCollapsed,
  }
}

/** 一次读盘的完整归一化（`fallbackColor` 见 sanitizeStyle） */
export function sanitizePersisted(
  raw: unknown,
  validCategoryIds: string[],
  fallbackColor: string = DEFAULT_STYLE.color
): PersistedState {
  const r = (raw ?? {}) as Partial<PersistedState>
  return {
    style: sanitizeStyle(r.style, fallbackColor),
    ui: sanitizeUi(r.ui, validCategoryIds),
  }
}

/** 折叠态摘要文案（F2.7：如 `24px · 描边 2 · 绝对 · #ffffff`） */
export function styleSummary(state: StyleState): string {
  const parts = [`${state.size}px`, `描边 ${state.strokeWidth}`]
  if (state.absoluteStrokeWidth) parts.push('绝对')
  parts.push(state.color)
  return parts.join(' · ')
}
