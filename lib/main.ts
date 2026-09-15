/**
 * Lucide 图标库插件 —— 主线程。
 *
 * 职责（PRD F3.1 / F3.2 / F3.3 / F3.4）：
 *   1. 拖拽导入：drop 事件拿到 absoluteX/absoluteY，几何中心对齐落点（零换算，附录 A.3）
 *   2. 点击插入：无选中 → 视口中心；选中 Frame/Group → 容器内居中（F3.2）
 *   3. 导入后处理：图层改名、clipsContent = false、自动选中、一次 commitUndo
 *   4. 状态持久化：mg.clientStorage 读写样式与界面状态（F3.4）
 *
 * 红线（HANDOFF §4 / PRD 附录 C）：
 *   - mg.on 回调不能是 async，异步逻辑内部起 IIFE
 *   - 带 pluginDrop 的 postMessage 不走 mg.ui.onmessage，而是触发主线程 drop 事件
 *   - 错误必须回传 UI 且是「用户能看懂的一句话」，不要只写 console（M0/M1 审核 P0-2）
 */

import { onDrop, type MgDropEvent } from '@lib/mg-drop'
import { buildSvg } from '@lib/svg'
import { STATE_KEY } from '@lib/store'
import type { PersistedState } from '@lib/store'
import { PluginMessage, sendMsgToUI, UIMessage } from '@messages/sender'
import type { InsertRequest, InsertResult } from '@messages/sender'

const PANEL_WIDTH = 440
const PANEL_HEIGHT = 664

/**
 * 插件生成节点的标记键。
 *
 * ⚠️ 这是修「嵌套插入」bug 的关键：导入后图标会被自动选中（F3.3 ③），
 *    而它本身也是 FrameNode —— 若不标记并排除，连续点击插入会把新图标
 *    嵌进上一个图标内部，图层树越插越深。
 */
const ORIGIN_KEY = 'lucideOrigin'
const ORIGIN_VALUE = 'lucide-icon'

mg.showUI(__html__, { width: PANEL_WIDTH, height: PANEL_HEIGHT })

/** 可容纳子节点的容器类型（F3.2：选中 Frame/Group 时插入其内居中） */
type ContainerNode = FrameNode | GroupNode

/** 读取插件标记（老客户端可能不支持 pluginData，一律降级为「不是插件生成的」） */
function isGeneratedByPlugin(node: SceneNode): boolean {
  try {
    return node.getPluginData(ORIGIN_KEY) === ORIGIN_VALUE
  } catch {
    return false
  }
}

/** 打上插件标记（失败不影响导入本身，只是下次会退回「视作普通容器」的旧行为） */
function markAsGenerated(node: SceneNode): void {
  try {
    node.setPluginData(ORIGIN_KEY, ORIGIN_VALUE)
  } catch {
    /* 忽略：不带 pluginData 的客户端上，仅失去嵌套保护 */
  }
}

/**
 * 判断选中节点能否作为「插入容器」（F3.2）。
 *
 * 插件自己生成的图标要排除掉，否则连续的点击插入会层层嵌套。
 * 注意这里刻意**不做类型谓词**（不写成 `node is ContainerNode`）：调用处需要先排除
 * 「插件生成的 FRAME」，而 `node is ContainerNode` 会把那个分支的类型收窄成 never。
 * 判定用普通布尔函数，收窄交给调用处的显式 `type === 'FRAME'` 判断。
 */
function isInsertableContainer(node: SceneNode | null | undefined): boolean {
  if (!node) return false
  if (node.type !== 'FRAME' && node.type !== 'GROUP') return false
  return !isGeneratedByPlugin(node)
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
 * 校验来自 UI 的载荷。返回错误文案，合法则返回 null。
 *
 * 之前这里对非法载荷是**静默 return**：用户点了没反应、也没有任何提示，
 * 完全无法判断是插件坏了还是自己点空了。
 */
function validateRequest(request: InsertRequest | null): string | null {
  if (!request || typeof request !== 'object') return '没有收到图标数据，请重新选择图标'
  if (typeof request.name !== 'string' || !request.name) return '图标数据缺少名称，请重新选择图标'
  if (!Array.isArray(request.nodes) || request.nodes.length === 0) {
    return `图标「${request.name}」没有可绘制的图形数据，请换一个图标`
  }
  return null
}

interface ImportOutcome {
  ok: boolean
  frame?: FrameNode
  error?: string
  errorDetail?: string
}

/**
 * 导入一个图标并做后处理（F3.3）：
 *  ① 图层重命名为图标名
 *  ② 容器 clipsContent = false
 *  ③ 新节点自动选中（便于后续放置与回调）
 *  ④ 打上插件标记（供 isContainerNode 排除）
 *
 * commitUndo 由调用方在落位之后执行，保证「撤销一步 = 回退整个导入」。
 */
async function importIcon(request: InsertRequest): Promise<ImportOutcome> {
  let svg: string
  try {
    svg = buildIconSvg(request)
  } catch (error) {
    return {
      ok: false,
      error: `图标「${request.name}」的图形数据异常，请换一个图标`,
      errorDetail: String(error),
    }
  }

  try {
    const frame = await mg.createNodeFromSvgAsync(svg)
    frame.clipsContent = false
    mg.document.currentPage.appendChild(frame)
    frame.name = request.name
    markAsGenerated(frame)
    mg.document.currentPage.selection = [frame]
    return { ok: true, frame }
  } catch (error) {
    return {
      ok: false,
      error: `「${request.name}」导入失败，请重试或换个图标`,
      errorDetail: String(error),
    }
  }
}

/** 把节点放置到页面坐标 (x, y)，几何中心对齐（PRD A.3） */
function placeAt(frame: FrameNode, x: number, y: number): void {
  frame.x = x - frame.width / 2
  frame.y = y - frame.height / 2
}

/** 依次点击插入时的横向间距：图标宽度的 0.5 倍 */
const INSERT_GAP_RATIO = 0.5

/**
 * 点击插入（F3.2）：决定目标容器与落点。
 *
 * 三种情况：
 *  - container：选中了普通 Frame/Group → 插入其内居中
 *  - sibling  ：选中了插件刚插入的图标 → 排到它右边
 *  - page     ：无选中 → 落视口中心
 *
 * sibling 这一支是修「嵌套插入」时补上的：被选中的插件图标会被 isInsertableContainer
 * 排除（否则嵌套），于是它会退化成 page，结果连续点击的图标全部叠在视口中心的
 * 同一个点上。改成横向排开，多次插入就是一行整齐的图标。
 */
function decideClickTarget(): {
  kind: 'page' | 'container' | 'sibling'
  container?: ContainerNode
  anchor?: FrameNode
} {
  const selection = mg.document.currentPage.selection
  const selected = selection && selection.length > 0 ? selection[0] : null
  if (!selected) return { kind: 'page' }

  // 普通 Frame / Group → 作为插入容器
  if (
    (selected.type === 'FRAME' || selected.type === 'GROUP') &&
    isInsertableContainer(selected)
  ) {
    return { kind: 'container', container: selected }
  }

  // 插件刚插入的图标 → 排到它右边。
  // 只接受「挂在页面根下」的：用户若把它拖进了别的容器，它的 x/y 就是容器内
  // 相对坐标，拿来当页面坐标会落错位置。
  if (
    selected.type === 'FRAME' &&
    isGeneratedByPlugin(selected) &&
    selected.parent === mg.document.currentPage
  ) {
    return { kind: 'sibling', anchor: selected }
  }

  return { kind: 'page' }
}

/** 组装一次导入结果 */
function buildResult(
  request: InsertRequest | null,
  source: 'drag' | 'click',
  startedAt: number,
  outcome: ImportOutcome,
  drop: InsertResult['drop']
): InsertResult {
  return {
    ok: outcome.ok,
    name: request?.name ?? '',
    source,
    elapsed: Date.now() - startedAt,
    imported:
      outcome.ok && outcome.frame
        ? { width: outcome.frame.width, height: outcome.frame.height }
        : null,
    error: outcome.error,
    errorDetail: outcome.errorDetail,
    drop,
  }
}

// ===== 状态持久化（F3.4）：UI 侧持久化不了 localStorage，统一走 clientStorage =====

/**
 * 内存兜底：clientStorage 不可用（老客户端 / 接口异常）时，
 * 至少保证本次插件会话内参数不丢，并明确告知用户「不会跨会话保留」。
 */
let stateCache: PersistedState | null = null

async function handleLoadState(): Promise<void> {
  let state: unknown = null
  try {
    const stored = await mg.clientStorage.getAsync(STATE_KEY)
    state = stored ?? null
  } catch (error) {
    // 读不到不是致命问题：用默认值启动即可，仅记录原因
    console.warn('[Lucide] 读取 clientStorage 失败，本次将使用默认样式参数', error)
    state = stateCache
  }
  sendMsgToUI({ type: PluginMessage.STATE_LOADED, data: { state } })
}

async function handleSaveState(payload: unknown): Promise<void> {
  const state = (payload ?? null) as PersistedState | null
  if (!state || typeof state !== 'object') return
  stateCache = state
  try {
    await mg.clientStorage.setAsync(STATE_KEY, state)
  } catch (error) {
    console.warn('[Lucide] 写入 clientStorage 失败，样式参数未能持久化', error)
  }
}

// ===== 拖拽导入（F3.1）=====

onDrop((event: MgDropEvent) => {
  // MasterGo 不允许 drop 回调是 async 函数，异步逻辑在内部自执行
  void (async () => {
    const startedAt = Date.now()
    const request = (event.dropMetadata ?? null) as InsertRequest | null
    const invalid = validateRequest(request)

    if (invalid) {
      sendMsgToUI({
        type: PluginMessage.INSERT_RESULT,
        data: buildResult(request, 'drag', startedAt, { ok: false, error: invalid }, {
          x: null,
          y: null,
          absoluteX: null,
          absoluteY: null,
        }),
      })
      return
    }

    const outcome = await importIcon(request as InsertRequest)
    if (outcome.ok && outcome.frame) {
      // 拖拽路径：几何中心对齐落点（零换算，PRD A.3）
      placeAt(outcome.frame, event.absoluteX, event.absoluteY)
      // 一次 commit（撤销一步即回退整个导入）
      mg.commitUndo()
    }

    sendMsgToUI({
      type: PluginMessage.INSERT_RESULT,
      data: buildResult(request, 'drag', startedAt, outcome, {
        x: null,
        y: null,
        absoluteX: outcome.ok ? event.absoluteX : null,
        absoluteY: outcome.ok ? event.absoluteY : null,
      }),
    })
  })()
})

// ===== UI → 主线程消息 =====

mg.ui.onmessage = (msg: { type: UIMessage; data?: unknown }) => {
  if (msg.type === UIMessage.LOAD_STATE) {
    void handleLoadState()
    return
  }

  if (msg.type === UIMessage.SAVE_STATE) {
    void handleSaveState(msg.data)
    return
  }

  if (msg.type !== UIMessage.INSERT_ICON) return

  // mg.ui.onmessage 不能是 async 函数，异步逻辑在内部自执行
  void (async () => {
    const startedAt = Date.now()
    const request = (msg.data ?? null) as InsertRequest | null
    const invalid = validateRequest(request)

    if (invalid) {
      sendMsgToUI({
        type: PluginMessage.INSERT_RESULT,
        data: buildResult(request, 'click', startedAt, { ok: false, error: invalid }, {
          x: null,
          y: null,
          absoluteX: null,
          absoluteY: null,
        }),
      })
      return
    }

    const target = decideClickTarget()
    const outcome = await importIcon(request as InsertRequest)
    let drop: InsertResult['drop'] = { x: null, y: null, absoluteX: null, absoluteY: null }

    if (outcome.ok && outcome.frame) {
      const frame = outcome.frame
      if (target.kind === 'container' && target.container) {
        // 选中容器：节点移入容器，容器内居中（相对坐标）
        const container = target.container
        container.appendChild(frame)
        frame.x = (container.width - frame.width) / 2
        frame.y = (container.height - frame.height) / 2
      } else if (target.kind === 'sibling' && target.anchor) {
        // 选中插件刚插入的图标：排到它右边（同一行）
        const anchor = target.anchor
        frame.x = anchor.x + anchor.width + Math.round(anchor.width * INSERT_GAP_RATIO)
        frame.y = anchor.y
        drop = { x: null, y: null, absoluteX: frame.x, absoluteY: frame.y }
      } else {
        // 无选中：落视口中心（绝对坐标）
        const center = mg.viewport.center
        placeAt(frame, center.x, center.y)
        drop = { x: null, y: null, absoluteX: center.x, absoluteY: center.y }
      }
      // 一次 commit（F3.3 ④）
      mg.commitUndo()
    }

    sendMsgToUI({
      type: PluginMessage.INSERT_RESULT,
      data: buildResult(request, 'click', startedAt, outcome, drop),
    })
  })()
}
