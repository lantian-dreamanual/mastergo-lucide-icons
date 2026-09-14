<template>
  <div class="style-bar" :class="{ collapsed }">
    <!-- 折叠态：一行摘要，点击任意处展开（F2.7） -->
    <button v-if="collapsed" class="summary-row" @click="toggle">
      <span class="summary-text">{{ summary }}</span>
      <span class="chevron">▾</span>
    </button>

    <!-- 展开态：尺寸 / 描边 / 绝对描边 / 颜色 -->
    <div v-else class="style-fields">
      <label class="field">
        <span class="field-label">尺寸 {{ style.size }}px</span>
        <input type="range" min="16" max="96" step="2" :value="style.size" @input="update('size', Number(($event.target as HTMLInputElement).value))" />
      </label>

      <label class="field">
        <span class="field-label">描边 {{ style.strokeWidth }}</span>
        <input type="range" min="0.5" max="6" step="0.1" :value="style.strokeWidth" @input="update('strokeWidth', Number(($event.target as HTMLInputElement).value))" />
      </label>

      <div class="row-inline">
        <label class="check">
          <input type="checkbox" :checked="style.absoluteStrokeWidth" @change="update('absoluteStrokeWidth', ($event.target as HTMLInputElement).checked)" />
          <span>绝对描边宽度</span>
        </label>

        <label class="color-field">
          <span class="color-label">颜色</span>
          <input type="color" :value="style.color" @input="update('color', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <button class="collapse-btn" @click="toggle" title="收起样式条">
        <span class="chevron">▾</span>
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { StyleState } from '@lib/store'
import { styleSummary } from '@lib/store'

const props = defineProps<{
  style: StyleState
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'update:style', value: StyleState): void
}>()

const summary = computed(() => styleSummary(props.style))

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
  border-bottom: 1px solid #e5e3db;
  background: #ffffff;
}
.style-fields {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 40px 10px 10px;
}
.field {
  display: block;
}
.field-label {
  display: block;
  margin-bottom: 2px;
  color: #5f5e5a;
  font-size: 12px;
}
.field input[type='range'] {
  width: 100%;
  margin: 0;
}
.row-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #5f5e5a;
}
.check input[type='checkbox'] {
  margin: 0;
}
.color-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-label {
  color: #5f5e5a;
  font-size: 12px;
}
.color-field input[type='color'] {
  width: 42px;
  height: 24px;
  padding: 0;
  border: 1px solid #d3d1c7;
  border-radius: 5px;
  background: none;
}
.collapse-btn {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid #d3d1c7;
  border-radius: 6px;
  background: #ffffff;
  color: #5f5e5a;
  cursor: pointer;
}
.collapse-btn:hover {
  background: #f5f4ef;
}
.collapsed {
  padding: 0;
}
.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid #e5e3db;
  background: #ffffff;
  color: #2c2c2a;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
}
.summary-row:hover {
  background: #f5f4ef;
}
.summary-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chevron {
  color: #888780;
}
</style>