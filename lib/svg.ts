/**
 * Lucide 图标 → SVG 字符串。
 *
 * Lucide 全部图标共用一套基线属性（24×24 viewBox、fill none、圆头圆角描边），
 * 所以「改样式」本质上就是拼字符串，不需要任何 MasterGo API 参与。
 * 主线程与插件 UI 两侧都会用到（UI 侧用于实时预览），因此不依赖 mg。
 *
 * 本文件同时是「可渲染值」的唯一校验入口：色值、尺寸、描边宽度在拼串前都会
 * 归一化。原因见 normalizeColor 的注释 —— 非法值会让 MasterGo 整个解析失败，
 * 而不是优雅降级。
 */

/** lucide 的 icon-nodes.json 结构：[标签名, 属性表] */
export type IconNode = [string, Record<string, string | number>]

/** 所有 lucide 图标的基准坐标系 */
export const LUCIDE_VIEWBOX = 24

export interface SvgOptions {
  nodes: IconNode[]
  /** 输出尺寸（px），同时写入 width/height 与 viewBox 缩放 */
  size: number
  /** 用户设定的描边粗细 */
  strokeWidth: number
  color: string
  /**
   * 绝对描边宽度，语义对齐 lucide.dev 与 lucide 源码：
   * 实际写入 SVG 的 stroke-width = strokeWidth × 24 / size，
   * 这样放大图标时描边视觉粗细保持不变（size=48、strokeWidth=2 时写入 1）。
   */
  absoluteStrokeWidth?: boolean
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * 图标默认描边色（静态兜底值）。**`lib/store.ts` 的 `DEFAULT_STYLE.color` 从这里取**。
 *
 * 为什么是白色：面板在系统深色外观下会切到深色底（`--mg-bg: #212121`），而网格预览
 * 用的就是这个颜色 —— 默认黑的话，深色面板里 1847 个图标全是黑描边，整片看不见
 * （用户 2026-09-15 反馈）。真实的默认值由 UI 侧 `preferredIconColor()` 按面板主题决定，
 * 这里的常量只在「拿不到主题信息」时兜底（主线程、测试）。
 *
 * ⚠️ 这个值同时也是**写入画布**的描边色。浅色画布上插进去会看不见，
 *    用样式条的颜色选择器改一次即可（会持久化）。
 */
export const DEFAULT_ICON_COLOR = '#ffffff'

/** 归一化时的兜底目标。与 DEFAULT_ICON_COLOR 同源，别再写第二份字面量 */
const FALLBACK_COLOR = DEFAULT_ICON_COLOR

/**
 * 归一化色值：只接受 #rgb / #rrggbb，其余一律回退。
 *
 * `fallback` 让调用方按上下文指定兜底色（UI 侧会传「面板主题对应的默认色」，
 * 这样浅色面板下兜底是黑、深色面板下是白，不会出现底色与线色相同的瞎猜结果）。
 *
 * ⚠️ 这不是多余的严格：色值会被拼进 SVG 字符串交给 `mg.createNodeFromSvgAsync` 解析，
 *    一个非法值（null / 对象 / 脏存储里的乱码）会导致**整个图标导入失败**，
 *    而不是「颜色显示不对」这种可容忍的降级。宁可回退默认色，不可崩。
 */
export function normalizeColor(value: unknown, fallback: string = FALLBACK_COLOR): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : fallback
}

/** 数值防御：非有限数回退默认值，并夹到合理区间（NaN 会让 SVG 整个失效） */
function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** 属性值转义：几何数据本身可信，但拼串前统一转义，避免任何来源产生畸形 SVG */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 过滤出结构合法的节点，防止 undefined 节点被拼成 `<undefined />` */
function isValidNode(node: unknown): node is IconNode {
  if (!Array.isArray(node) || node.length < 2) return false
  const [tag, attrs] = node
  return typeof tag === 'string' && tag.length > 0 && !!attrs && typeof attrs === 'object'
}

export function buildSvg(options: SvgOptions): string {
  const size = safeNumber(options.size, 24, 1, 4096)
  const strokeWidth = safeNumber(options.strokeWidth, 2, 0, 1024)
  const color = normalizeColor(options.color)
  const absoluteStrokeWidth = options.absoluteStrokeWidth === true

  const effectiveStrokeWidth = absoluteStrokeWidth
    ? (strokeWidth * LUCIDE_VIEWBOX) / size
    : strokeWidth

  const children = (Array.isArray(options.nodes) ? options.nodes : [])
    .filter(isValidNode)
    .map(([tag, attrs]) => {
      const serialized = Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
        .join(' ')
      return `<${tag} ${serialized} />`
    })
    .join('')

  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ` width="${size}" height="${size}"`,
    ` viewBox="0 0 ${LUCIDE_VIEWBOX} ${LUCIDE_VIEWBOX}"`,
    ' fill="none"',
    ` stroke="${color}" stroke-width="${effectiveStrokeWidth}"`,
    ' stroke-linecap="round" stroke-linejoin="round">',
    children,
    '</svg>',
  ].join('')
}
