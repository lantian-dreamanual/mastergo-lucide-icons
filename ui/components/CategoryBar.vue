<template>
  <div class="sidebar">
    <div class="cat-list">
      <button
        v-for="cat in items"
        :key="cat.id"
        class="cat-item"
        :class="{ active: cat.id === modelValue }"
        @click="$emit('update:modelValue', cat.id)"
      >
        {{ cat.display }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { categoryZhTitle } from '@lib/icons'
import type { CategoryInfo } from '@lib/icons'

const props = defineProps<{
  categories: CategoryInfo[]
  modelValue: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

/**
 * 「全部」 + 官方分类，分类名优先显示中文。
 *
 * ⚠️ 不要写 `displayName.split(' ')[0]` 去「取中文部分」：上游新增分类而中文表
 *    没跟进时，那样会把英文标题截成首词（`Food & Beverage` → `Food`）。
 *    正确做法是取不到中文就整段回退官方 title。
 */
const items = computed<Array<{ id: string; display: string }>>(() => [
  { id: 'all', display: '全部' },
  ...props.categories.map((c) => ({ id: c.id, display: categoryZhTitle(c.id) || c.title })),
])
</script>

<style scoped>
.sidebar {
  width: 84px;
  flex-shrink: 0;
  border-right: 1px solid var(--mg-border);
  background: var(--mg-bg);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}

/* 细滚动条 */
.sidebar::-webkit-scrollbar {
  width: 3px;
}
.sidebar::-webkit-scrollbar-thumb {
  background: var(--mg-border);
  border-radius: 2px;
}
.sidebar::-webkit-scrollbar-track {
  background: transparent;
}

.cat-list {
  display: flex;
  flex-direction: column;
}

.cat-item {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--mg-text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s, color 0.12s;
}

.cat-item:hover {
  background: var(--mg-bg-hover);
  color: var(--mg-text);
}

.cat-item.active {
  background: var(--mg-primary-bg);
  color: var(--mg-primary);
  border-left-color: var(--mg-primary);
  font-weight: 600;
}
</style>
