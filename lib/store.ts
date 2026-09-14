/**
 * 样式参数 + 界面状态持久化（PRD F2.7 / F3.4）。
 *
 * - 样式参数：尺寸 / 描边 / 绝对描边 / 颜色，写入 localStorage，重开面板沿用（S3）
 * - 界面状态：上次所在分类、样式条是否折叠，同样持久化
 * - 纯前端逻辑，不依赖 mg
 *
 * ⚠️ MasterGo 插件 UI 跑在 data: URL 的 iframe 里，localStorage 被浏览器禁用
 *    （Storage is disabled inside data: URLs）。访问会抛 DOMException。
 *    因此所有 localStorage 操作都走 safeStorage() 降级：
 *    可用时用真 localStorage（跨会话持久化）；不可用时退回内存 Map（当次会话有效）。
 */

export interface StyleState {
  size: number
  strokeWidth: number
  absoluteStrokeWidth: boolean
  color: string
}

export interface UiState {
  /** 上次所在分类 id（'all' = 全部） */
  category: string
  /** 样式条是否折叠（F2.7） */
  styleBarCollapsed: boolean
  /** 分类条是否收起（F1.7） */
  categoryCollapsed: boolean
}

const STYLE_KEY = 'lucide-mastergo.style'
const UI_KEY = 'lucide-mastergo.ui'

export const DEFAULT_STYLE: StyleState = {
  size: 24,
  strokeWidth: 2,
  absoluteStrokeWidth: false,
  color: '#000000',
}

export const DEFAULT_UI: UiState = {
  category: 'all',
  styleBarCollapsed: false,
  categoryCollapsed: false,
}

/** 内存降级存储（data: URL 下 localStorage 不可用时兜底） */
const memoryStore = new Map<string, string>()

/** 安全 Storage 访问：可用返回 localStorage，不可用返回内存降级对象 */
interface SafeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function safeStorage(): SafeStorage {
  try {
    // 探测 localStorage 是否可用（data: URL 会抛 DOMException）
    const testKey = '__lucide_probe__'
    localStorage.setItem(testKey, '1')
    localStorage.removeItem(testKey)
    return localStorage
  } catch {
    return {
      getItem(key: string) {
        return memoryStore.has(key) ? memoryStore.get(key)! : null
      },
      setItem(key: string, value: string) {
        memoryStore.set(key, value)
      },
    }
  }
}

const storage = safeStorage()

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

export function loadStyle(): StyleState {
  return safeParse<StyleState>(storage.getItem(STORAGE_KEY(STYLE_KEY)), DEFAULT_STYLE)
}

export function saveStyle(state: StyleState): void {
  storage.setItem(STORAGE_KEY(STYLE_KEY), JSON.stringify(state))
}

export function loadUi(): UiState {
  return safeParse<UiState>(storage.getItem(STORAGE_KEY(UI_KEY)), DEFAULT_UI)
}

export function saveUi(state: UiState): void {
  storage.setItem(STORAGE_KEY(UI_KEY), JSON.stringify(state))
}

/** 统一加前缀，避免与其他插件冲突 */
function STORAGE_KEY(key: string): string {
  return `lucide-mastergo.${key}`
}

/** 折叠态摘要文案（F2.7：如 `24px · 描边 2 · 绝对 · #000000`） */
export function styleSummary(state: StyleState): string {
  const parts = [`${state.size}px`, `描边 ${state.strokeWidth}`]
  if (state.absoluteStrokeWidth) parts.push('绝对')
  parts.push(state.color)
  return parts.join(' · ')
}