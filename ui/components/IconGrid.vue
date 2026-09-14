<template>
  <div class="grid-root">
    <div ref="scrollEl" class="grid-scroll" @scroll.passive="onScroll">
      <div class="grid-spacer" :style="{ height: totalHeight + 'px' }">
        <div class="grid-window" :style="{ transform: `translateY(${startY}px)` }">
          <div
            v-for="icon in visibleIcons"
            :key="icon.name"
            class="grid-cell"
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
import { buildSvg } from '@lib/svg'
import type { IconEntry } from '@lib/icons'
import type { StyleState } from '@lib/store'
import { sendMsgToPlugin, UIMessage, type InsertRequest } from '@messages/sender'

const props = defineProps<{
  icons: IconEntry[]
  style: StyleState
}>()

const emit = defineEmits<{
  (e: 'clear-filters'): void
}>()

const CELL_W = 72
const CELL_H = 72
const COLS = 5
const ROWS = 6

const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(480)
const hovered = ref<string | null>(null)

const visibleIcons = computed(() => {
  const first = Math.max(0, Math.floor(scrollTop.value / CELL_H) * COLS)
  const count = ROWS * COLS + COLS // 上下各多渲染一列，滚动不露白
  return props.icons.slice(first, first + count)
})

const totalHeight = computed(() => {
  const rows = Math.ceil(props.icons.length / COLS)
  return Math.max(rows * CELL_H, viewportH.value)
})

const startY = computed(() => {
  return Math.floor(scrollTop.value / CELL_H) * CELL_H
})

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
    { pluginDrop: { clientX: event.clientX, clientY: event.clientY, dropMetadata: currentRequest(icon, 'drag') } },
    '*'
  )
}

function handleClick(icon: IconEntry): void {
  sendMsgToPlugin({ type: UIMessage.INSERT_ICON, data: currentRequest(icon, 'click') })
}

onMounted(() => {
  if (scrollEl.value) viewportH.value = scrollEl.value.clientHeight
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
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  padding: 6px;
  box-sizing: border-box;
}
.grid-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56px;
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