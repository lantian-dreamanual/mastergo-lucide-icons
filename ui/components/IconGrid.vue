<template>
  <div class="grid-root">
    <div ref="scrollEl" class="grid-scroll" @scroll.passive="onScroll">
      <div class="grid-spacer" :style="{ height: totalHeight + 'px' }">
        <div class="grid-window" :style="windowStyle">
          <div
            v-for="icon in visibleIcons"
            :key="icon.name"
            class="grid-cell"
            :style="cellStyle"
            :title="icon.name"
            draggable="true"
            @dragstart="handleDragStart($event, icon)"
            @dragend="handleDragEnd($event, icon)"
            @click="handleClick(icon)"
            @mouseenter="hovered = icon.name"
            @mouseleave="hovered = null"
          >
            <div class="cell-inner" v-html="previewSvg(icon)"></div>
            <span v-if="hovered === icon.name" class="cell-name">{{ icon.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!icons.length" class="empty-state">
      <p>没有匹配的图标</p>
      <button class="ghost" @click="$emit('clear-filters')">清空筛选</button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { buildSvg } from '@lib/svg'
import type { IconEntry } from '@lib/icons'
import type { StyleState } from '@lib/store'
import { sendMsgToPlugin, UIMessage, type InsertRequest } from '@messages/sender'

/**
 * 虚拟滚动网格（拖拽 + 点击导入）。
 *
 * ## ⚠️ 几何常量是唯一真相源
 * 下面这几个常量同时驱动两件事：① 注入到 CSS（列数/间距/内边距/格子高）
 * ② 滚动数学（行高、第一条可见行、渲染行数）。
 *
 * 之前这里踩过一次：CSS 里格子是 56px 高、间距 6px（实际行距 62px），
 * 但 TS 里按 CELL_H = 72 算，于是滚过约 250 个图标后视口底部开始白屏、
 * 滚动条也偏长 16%。**改动任何一个数值，两边必须同时生效** —— 靠的就是
 * 只在这里定义、其余地方一律引用，不要再往 CSS 里写死像素值。
 */
const COLS = 5
/** 单格高度 */
const CELL_H = 56
/** 格子间距（grid gap） */
const GAP = 6
/** 网格容器内边距 */
const PAD = 6
/** 单行占位高度 = 格子高 + 行间距 */
const ROW_H = CELL_H + GAP

const props = defineProps<{
  icons: IconEntry[]
  style: StyleState
}>()

const emit = defineEmits<{
  (e: 'clear-filters'): void
}>()

const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(480)
const hovered = ref<string | null>(null)

/** 格子高度直接由 TS 常量下发给每个格子；CSS 里不再另写一份（避免两处漂移） */
const cellStyle: CSSProperties = { height: `${CELL_H}px` }

const windowStyle = computed<CSSProperties>(() => ({
  transform: `translateY(${startY.value}px)`,
  gridTemplateColumns: `repeat(${COLS}, 1fr)`,
  gap: `${GAP}px`,
  padding: `${PAD}px`,
}))

/**
 * 第一条可见行（0 基）。
 * 内容从 PAD 之后才开始，所以先减 PAD 再除以行高 —— 否则每行会累积一个
 * 恒定偏移，滚到后面同样会露白。
 */
const firstRow = computed(() => Math.max(0, Math.floor((scrollTop.value - PAD) / ROW_H)))

/** 渲染行数 = 视口能容纳的行数 + 1 行缓冲（滚动时不露白） */
const rowsToRender = computed(() => Math.ceil(viewportH.value / ROW_H) + 1)

const visibleIcons = computed(() => {
  const first = firstRow.value * COLS
  return props.icons.slice(first, first + rowsToRender.value * COLS)
})

/** 占位高度 = PAD + 行数×格子高 + 行间距×(行数-1) + PAD = 行数×ROW_H + PAD */
const totalHeight = computed(() => {
  const rows = Math.max(1, Math.ceil(props.icons.length / COLS))
  return Math.max(rows * ROW_H + PAD, viewportH.value)
})

const startY = computed(() => firstRow.value * ROW_H)

function previewSvg(icon: IconEntry): string {
  return buildSvg({
    nodes: icon.nodes,
    size: props.style.size,
    strokeWidth: props.style.strokeWidth,
    color: props.style.color,
    absoluteStrokeWidth: props.style.absoluteStrokeWidth,
  })
}

function onScroll(): void {
  if (scrollEl.value) scrollTop.value = scrollEl.value.scrollTop
}

function currentRequest(icon: IconEntry, source: 'drag' | 'click'): InsertRequest {
  return {
    name: icon.name,
    nodes: icon.nodes,
    size: props.style.size,
    strokeWidth: props.style.strokeWidth,
    color: props.style.color,
    absoluteStrokeWidth: props.style.absoluteStrokeWidth,
    source,
  }
}

function handleDragStart(event: DragEvent, icon: IconEntry): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', icon.name)
  event.dataTransfer.effectAllowed = 'copy'
}

function handleDragEnd(event: DragEvent, icon: IconEntry): void {
  // pluginDrop 是 MasterGo 约定字段：带它就不走 mg.ui.onmessage，而是触发主线程 drop 事件
  parent.postMessage(
    {
      pluginDrop: {
        clientX: event.clientX,
        clientY: event.clientY,
        dropMetadata: currentRequest(icon, 'drag'),
      },
    },
    '*'
  )
}

function handleClick(icon: IconEntry): void {
  sendMsgToPlugin({ type: UIMessage.INSERT_ICON, data: currentRequest(icon, 'click') })
}

/** 视口高度随面板尺寸变化，用 ResizeObserver 跟随（否则渲染行数会算少、滚动露白） */
function measure(): void {
  const el = scrollEl.value
  if (!el) return
  const h = el.clientHeight
  if (h > 0) viewportH.value = h
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
    observer = new ResizeObserver(measure)
    observer.observe(scrollEl.value)
  }
})

// 切换分类/搜索后，列表内容变化，必须重置滚动位置（否则残留 scrollTop 会让可视窗口越界变空）
watch(
  () => props.icons,
  () => {
    scrollTop.value = 0
    if (scrollEl.value) scrollEl.value.scrollTop = 0
  }
)

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  scrollEl.value = null
})
</script>

<style scoped>
.grid-root {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--mg-bg, #fafafa);
}
.grid-scroll {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
.grid-spacer {
  position: relative;
  width: 100%;
}
.grid-window {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  display: grid;
  box-sizing: border-box;
  will-change: transform;
}
.grid-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 高度由 :style 从 TS 常量注入（见 cellStyle），此处不写死值 */
  border: 1px solid transparent;
  border-radius: var(--mg-radius-md, 8px);
  cursor: grab;
  user-select: none;
  transition: background 0.1s, border-color 0.1s;
}
.grid-cell:hover {
  background: var(--mg-bg-hover, #f0f0f0);
  border-color: var(--mg-border, #e5e3db);
}
.grid-cell:active {
  cursor: grabbing;
}
.cell-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.cell-inner :deep(svg) {
  display: block;
  max-width: 100%;
  max-height: 100%;
}
.cell-name {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #ffffff;
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--mg-text-tertiary, #b0aea6);
}
.empty-state p {
  margin: 0;
  font-size: 13px;
}
.empty-state button {
  padding: 5px 12px;
  border: 1px solid var(--mg-border, #e5e3db);
  border-radius: var(--mg-radius-sm, 6px);
  background: var(--mg-bg, #ffffff);
  color: var(--mg-text-secondary, #888780);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: background 0.12s;
}
.empty-state button:hover {
  background: var(--mg-bg-hover, #f0f0f0);
}
</style>
