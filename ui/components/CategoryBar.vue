<template>
  <div class="category-bar" :class="{ collapsed }">
    <div v-if="!collapsed" ref="scrollEl" class="cat-scroll">
      <button
        v-for="cat in items"
        :key="cat.id"
        class="cat-chip"
        :class="{ active: cat.id === modelValue }"
        @click="$emit('update:modelValue', cat.id)"
      >
        {{ cat.display }}
      </button>
    </div>

    <button class="toggle-btn" :title="collapsed ? '展开分类条' : '收起分类条'" @click="toggle">
      {{ collapsed ? '▸' : '▾' }}
    </button>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { categoryDisplayName } from '@lib/icons'
import type { CategoryInfo } from '@lib/icons'

const props = defineProps<{
  categories: CategoryInfo[]
  modelValue: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'toggle'): void
}>()

/** 「全部」 + 官方分类，中文双语显示（M2-A） */
const items = computed<Array<{ id: string; display: string }>>(() => [
  { id: 'all', display: '全部' },
  ...props.categories.map((c) => ({ id: c.id, display: categoryDisplayName(c) })),
])

function toggle(): void {
  emit('toggle')
}
</script>

<style scoped>
.category-bar {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #e5e3db;
  background: #ffffff;
}
.cat-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  padding: 6px 0 6px 8px;
  -webkit-overflow-scrolling: touch;
}
.cat-chip {
  display: inline-block;
  margin-right: 6px;
  padding: 4px 10px;
  border: 1px solid #d3d1c7;
  border-radius: 999px;
  background: #ffffff;
  color: #5f5e5a;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
}
.cat-chip:hover {
  border-color: #185fa5;
  color: #185fa5;
}
.cat-chip.active {
  border-color: #185fa5;
  background: #185fa5;
  color: #ffffff;
}
.toggle-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin: 0 4px 0 0;
  padding: 0;
  border: 1px solid #d3d1c7;
  border-radius: 6px;
  background: #ffffff;
  color: #5f5e5a;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.toggle-btn:hover {
  background: #f5f4ef;
}
.collapsed {
  padding: 0;
  border-bottom: none;
}
.collapsed .toggle-btn {
  margin: 2px;
}
</style>