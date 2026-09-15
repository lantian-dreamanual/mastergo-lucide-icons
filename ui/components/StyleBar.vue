<template>
  <div class="style-bar" :class="{ collapsed }">
    <!-- 折叠态：一行摘要，点击任意处展开（F2.7） -->
    <button v-if="collapsed" class="summary-row" @click="toggle">
      <span class="summary-text">{{ summary }}</span>
      <svg class="chevron chevron--right" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <!-- 展开态：尺寸 / 描边 / 绝对描边 / 颜色 -->
    <div v-else class="style-fields">
      <div class="style-header" @click="toggle">
        <span class="summary-text">{{ summary }}</span>
        <svg class="chevron chevron--up" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      <!-- 尺寸滑块 -->
      <div class="slider-row">
        <div class="slider-label">
          <span>尺寸</span>
          <span class="val">{{ style.size }}px</span>
        </div>
        <div class="slider-track-wrap">
          <div class="slider-track-bg"></div>
          <div class="slider-track-fill" :style="{ width: sizeFillPercent + '%' }"></div>
          <input
            type="range"
            :min="SIZE_RANGE.min"
            :max="SIZE_RANGE.max"
            step="2"
            :value="style.size"
            @input="update('size', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>

      <!-- 描边滑块 -->
      <div class="slider-row">
        <div class="slider-label">
          <span>描边宽度</span>
          <span class="val">{{ style.strokeWidth.toFixed(1) }}</span>
        </div>
        <div class="slider-track-wrap">
          <div class="slider-track-bg"></div>
          <div class="slider-track-fill" :style="{ width: strokeFillPercent + '%' }"></div>
          <input
            type="range"
            :min="STROKE_RANGE.min"
            :max="STROKE_RANGE.max"
            step="0.1"
            :value="style.strokeWidth"
            @input="update('strokeWidth', Number(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>

      <!-- 开关 toggle -->
      <div class="toggle-row">
        <span class="toggle-label">绝对描边宽度</span>
        <label class="toggle">
          <input
            type="checkbox"
            :checked="style.absoluteStrokeWidth"
            @change="update('absoluteStrokeWidth', ($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle-track"></span>
        </label>
      </div>

      <!-- 颜色选择器 -->
      <div class="color-row">
        <span class="color-label">颜色</span>
        <div class="color-picker">
          <span class="color-hex">{{ style.color }}</span>
          <div class="color-swatch" :style="{ background: style.color }">
            <input
              type="color"
              :value="style.color"
              @input="update('color', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { StyleState } from '@lib/store'
import { SIZE_RANGE, STROKE_RANGE, styleSummary } from '@lib/store'

const props = defineProps<{
  style: StyleState
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'update:style', value: StyleState): void
}>()

const summary = computed(() => styleSummary(props.style))

/** 滑块已选区间百分比（范围来自 store，与 input 的 min/max 同源） */
const sizeFillPercent = computed(
  () => ((props.style.size - SIZE_RANGE.min) / (SIZE_RANGE.max - SIZE_RANGE.min)) * 100
)

const strokeFillPercent = computed(
  () => ((props.style.strokeWidth - STROKE_RANGE.min) / (STROKE_RANGE.max - STROKE_RANGE.min)) * 100
)

function toggle(): void {
  emit('toggle')
}

/** 单字段更新：emit 整个 style 对象，触发父组件响应式更新 */
function update<K extends keyof StyleState>(key: K, value: StyleState[K]): void {
  emit('update:style', { ...props.style, [key]: value })
}
</script>

<style scoped>
.style-bar {
  border-bottom: 1px solid var(--mg-border);
  background: var(--mg-bg);
}

/* ===== 展开态 ===== */
.style-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 10px 8px;
}

/* ===== 可点击的 header ===== */
.style-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 2px 0;
}
.style-header:hover {
  opacity: 0.8;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid var(--mg-border);
  background: var(--mg-bg);
  color: var(--mg-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  transition: background 0.12s;
}
.summary-row:hover {
  background: var(--mg-bg-hover);
}

.summary-text {
  font-weight: 600;
  font-size: 12px;
  color: var(--mg-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 折叠/展开指示箭头（F2.7）。
 *
 * ⚠️ 不要换回 `▸` / `▴` 这类文字字形 —— 原来用 `font-size: 10px` 的字形 + 最浅一档
 *    文字色，实测在深色面板下基本看不见（用户 2026-09-15 反馈「三角标太小根本看不到」）。
 *    文字字形的实际墨迹只占字号的一小半，10px 字号渲染出来只有 4~5px；
 *    SVG 是几何尺寸，14px 就是实打实的 14px，且不受字体/回退字体影响。
 *
 * 基础形状是向下的 chevron；两态靠旋转复用同一段路径，语义与旧版一致：
 *   收起（▸）→ 转 -90°；展开（▴）→ 转 180°。
 */
.chevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-left: 4px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--mg-text-secondary);
  /* 显式指定旋转基准：别依赖浏览器对 transform-box 初始值的实现差异
     （早期 SVG 规范把原点当 0 0，会让箭头转出可视区）。路径中心就在 12,12，
     取 viewBox 中心即可稳定居中。 */
  transform-box: view-box;
  transform-origin: center;
  transition: transform 0.15s, color 0.15s;
}
.chevron--right {
  transform: rotate(-90deg);
}
.chevron--up {
  transform: rotate(180deg);
}
.summary-row:hover .chevron,
.style-header:hover .chevron {
  color: var(--mg-text);
}

/* ===== 滑块 ===== */
.slider-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--mg-text-secondary);
}
.slider-label .val {
  color: var(--mg-text);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

/* 滑块轨道：背景 + 已选填充 + 原生 input 叠加 */
.slider-track-wrap {
  position: relative;
  width: 100%;
  height: 16px;
  display: flex;
  align-items: center;
}
.slider-track-bg {
  position: absolute;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--mg-border);
  pointer-events: none;
}
.slider-track-fill {
  position: absolute;
  height: 4px;
  border-radius: 2px;
  background: var(--mg-primary);
  pointer-events: none;
}
.slider-track-wrap input[type='range'] {
  -webkit-appearance: none;
  position: relative;
  width: 100%;
  height: 16px;
  margin: 0;
  background: transparent;
  outline: none;
  z-index: 1;
}
.slider-track-wrap input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--mg-bg);
  border: 2px solid var(--mg-primary);
  cursor: pointer;
  transition: transform 0.1s;
}
.slider-track-wrap input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

/* ===== 开关 toggle ===== */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toggle-label {
  font-size: 12px;
  color: var(--mg-text-secondary);
}
.toggle {
  position: relative;
  width: 30px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}
.toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 9px;
  background: var(--mg-border);
  transition: background 0.2s;
}
.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  transition: transform 0.2s;
}
.toggle input:checked + .toggle-track {
  background: var(--mg-primary);
}
.toggle input:checked + .toggle-track::after {
  transform: translateX(12px);
}

/* ===== 颜色选择器 ===== */
.color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.color-label {
  font-size: 12px;
  color: var(--mg-text-secondary);
}
.color-picker {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-hex {
  font-size: 11px;
  color: var(--mg-text-secondary);
  font-variant-numeric: tabular-nums;
}
.color-swatch {
  width: 24px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--mg-border);
  cursor: pointer;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
}
.color-swatch input[type='color'] {
  position: absolute;
  inset: -2px;
  width: calc(100% + 4px);
  height: calc(100% + 4px);
  border: none;
  padding: 0;
  cursor: pointer;
  opacity: 0;
}

/* ===== 折叠态 ===== */
.collapsed {
  padding: 0;
}
</style>
