/**
 * Lucide 图标 → SVG 字符串。
 *
 * Lucide 全部图标共用一套基线属性（24×24 viewBox、fill none、圆头圆角描边），
 * 所以「改样式」本质上就是拼字符串，不需要任何 MasterGo API 参与。
 * 主线程与插件 UI 两侧都会用到（UI 侧用于实时预览），因此不依赖 mg。
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

export function buildSvg(options: SvgOptions): string {
  const { nodes, size, strokeWidth, color, absoluteStrokeWidth = false } = options
  const effectiveStrokeWidth = absoluteStrokeWidth
    ? (strokeWidth * LUCIDE_VIEWBOX) / size
    : strokeWidth

  const children = nodes
    .map(([tag, attrs]) => {
      const serialized = Object.entries(attrs)
        .map(([key, value]) => `${key}="${value}"`)
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

/**
 * 探针专用十字准星：几何中心严格落在 viewBox 正中（12,12）。
 * 主线程把它整体偏移半个宽高后落位，于是「准星中心」就是传过去的落点坐标，
 * 落点准不准可以肉眼直接判断。
 */
export function crosshairNodes(color: string): IconNode[] {
  return [
    ['path', { d: 'M12 2v20' }],
    ['path', { d: 'M2 12h20' }],
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['circle', { cx: 12, cy: 12, r: 1.5, fill: color }],
  ]
}
