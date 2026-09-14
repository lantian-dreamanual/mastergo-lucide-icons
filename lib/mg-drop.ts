/**
 * MasterGo 的 drop 事件补齐层。
 *
 * UI 侧 postMessage 携带 pluginDrop 字段时会触发主线程的 drop 事件（不再走 mg.ui.onmessage），
 * 但 @mastergo/plugin-typings@2.19.2 尚未声明这个事件，所以这里单独补类型。
 * 官方文档：https://developers.mastergo.com/types/dropEvent.html
 */
export interface MgDropEvent {
  /** 相对于画布左上角的页面定位 x 坐标 */
  x: number
  /** 相对于画布左上角的页面定位 y 坐标 */
  y: number
  /** 画布内 x 坐标 */
  absoluteX: number
  /** 画布内 y 坐标 */
  absoluteY: number
  /** 来源于插件 UI 传输的原始数据 */
  dropMetadata?: unknown
}

type MgEventHost = {
  on(type: 'drop', listener: (event: MgDropEvent) => void): void
}

/**
 * 监听 drop 事件。
 *
 * 注意：MasterGo 运行时不允许该回调是 async 函数（官方示例仓库里也明确标注了这一点），
 * 需要在回调内自行起异步 IIFE。
 */
export function onDrop(listener: (event: MgDropEvent) => void): void {
  ;(mg as unknown as MgEventHost).on('drop', listener)
}
