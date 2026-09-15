/**
 * Lucide 图标库插件 —— 主线程。
 *
 * 职责（PRD F3.1 / F3.2 / F3.3）：
 *   1. 拖拽导入：drop 事件拿到 absoluteX/absoluteY，几何中心对齐落点（零换算，附录 A.3）
 *   2. 点击插入：无选中 → 视口中心；选中 Frame/Group → 容器内居中（F3.2）
 *   3. 导入后处理：图层改名、clipsContent = false、自动选中、一次 commitUndo
 *
 * 红线（HANDOFF §4 / PRD 附录 C）：
 *   - mg.on 回调不能是 async，异步逻辑内部起 IIFE
 *   - 带 pluginDrop 的 postMessage 不走 mg.ui.onmessage，而是触发主线程 drop 事件
 */

import { onDrop, type MgDropEvent } from '@lib/mg-drop'
import { buildSvg } from '@lib/svg'
import { PluginMessage, sendMsgToUI, UIMessage } from '@messages/sender'
import type { InsertRequest, InsertResult } from '@messages/sender'

const PANEL_WIDTH = 440
const PANEL_HEIGHT = 664

mg.showUI(__html__, { width: PANEL_WIDTH, height: PANEL_HEIGHT })

/** 可容纳子节点的容器类型（F3.2：选中 Frame/Group 时插入其内居中） */
type ContainerNode = FrameNode | GroupNode

function isContainerNode(node: SceneNode | null | undefined): node is ContainerNode {
  if (!node) return false
  return node.type === 'FRAME' || node.type === 'GROUP'
}

/** 构建 SVG 字符串（与 UI 预览同源，F2.5） */
function buildIconSvg(request: InsertRequest): string {
  return buildSvg({
    nodes: request.nodes,
    size: request.size,
    strokeWidth: request.strokeWidth,
    color: request.color,
    absoluteStrokeWidth: request.absoluteStrokeWidth,
  })
}

/**
 * 导入一个图标并做后处理（F3.3）：
 *  ① 图层重命名为图标名
 *  ② 容器 clipsContent = false
 *  ③ 新节点自动选中（便于后续放置与回调）
 *  ④ 一次 commitUndo（撤销一步即回退）
 *
 * 返回创建好的 FrameNode（已 append 到 currentPage，坐标尚未设定）。
 */
async function importIcon(request: InsertRequest): Promise<{
  ok: boolean
  frame?: FrameNode
  error?: string
}> {
  const svg = buildIconSvg(request)
  try {
    const frame = await mg.createNodeFromSvgAsync(svg)
    // ② 容器不裁剪（保证图标边缘不被裁掉）
    frame.clipsContent = false
    mg.document.currentPage.appendChild(frame)
    // ① 图层重命名
    frame.name = request.name
    // ③ 自动选中
    mg.document.currentPage.selection = [frame]
    return { ok: true, frame }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** 把节点放置到页面坐标 (x, y)，几何中心对齐（PRD A.3） */
function placeAt(frame: FrameNode, x: number, y: number): void {
  frame.x = x - frame.width / 2
  frame.y = y - frame.height / 2
}

/**
 * 点击插入（F3.2）：决定目标容器与落点。
 * 返回 null 表示无选中 → 落视口中心（page 坐标系）。
 * 否则返回选中容器，节点将以容器内坐标居中。
 */
function decideClickTarget(): {
  kind: 'page' | 'container'
  container?: ContainerNode
} {
  const selection = mg.document.currentPage.selection
  const selected = selection && selection.length > 0 ? selection[0] : null
  if (isContainerNode(selected)) {
    return { kind: 'container', container: selected }
  }
  return { kind: 'page' }
}

onDrop((event: MgDropEvent) => {
  // MasterGo 不允许 drop 回调是 async 函数，异步逻辑在内部自执行
  void (async () => {
    const request = (event.dropMetadata ?? null) as InsertRequest | null
    if (!request || !request.nodes) {
      sendMsgToUI({
        type: PluginMessage.ERROR,
        data: { message: 'dropMetadata 里没有 request，无法建节点', received: event.dropMetadata },
      })
      return
    }

    const startedAt = Date.now()
    const { ok, frame, error } = await importIcon(request)
    if (ok && frame) {
      // 拖拽路径：几何中心对齐落点（零换算，PRD A.3）
      placeAt(frame, event.absoluteX, event.absoluteY)
      // ④ 一次 commit（撤销一步即回退整个导入）
      mg.commitUndo()
    }

    const payload: InsertResult = {
      ok,
      name: request.name,
      source: 'drag',
      elapsed: Date.now() - startedAt,
      imported: ok && frame ? { width: frame.width, height: frame.height } : null,
      error,
      drop: {
        x: null,
        y: null,
        absoluteX: ok ? event.absoluteX : null,
        absoluteY: ok ? event.absoluteY : null,
      },
    }
    sendMsgToUI({ type: PluginMessage.INSERT_RESULT, data: payload })
  })()
})

mg.ui.onmessage = (msg: { type: UIMessage; data?: unknown }) => {
  const request = (msg.data ?? null) as InsertRequest | null

  if (msg.type === UIMessage.INSERT_ICON && request) {
    void (async () => {
      const startedAt = Date.now()
      const target = decideClickTarget()
      const { ok, frame, error } = await importIcon(request)

      if (ok && frame) {
        if (target.kind === 'container' && target.container) {
          // 选中容器：节点移入容器，容器内居中（相对坐标）
          const container = target.container
          container.appendChild(frame)
          frame.x = (container.width - frame.width) / 2
          frame.y = (container.height - frame.height) / 2
        } else {
          // 无选中：落视口中心（绝对坐标）
          const center = mg.viewport.center
          placeAt(frame, center.x, center.y)
        }
        // 一次 commit（F3.3 ④）
        mg.commitUndo()
      }

      const payload: InsertResult = {
        ok,
        name: request.name,
        source: 'click',
        elapsed: Date.now() - startedAt,
        imported: ok && frame ? { width: frame.width, height: frame.height } : null,
        error,
        drop: {
          x: null,
          y: null,
          absoluteX: null,
          absoluteY: null,
        },
      }
      sendMsgToUI({ type: PluginMessage.INSERT_RESULT, data: payload })
    })()
  }
}