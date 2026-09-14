<template>
  <div class="wrap">
    <!-- 顶部：搜索框 -->
    <div class="top">
      <input
        ref="searchEl"
        v-model="query"
        type="text"
        placeholder="搜索图标名或关键词（Esc 清空）"
        class="search"
        @keydown.esc="query = ''"
      />
    </div>

    <!-- 分类条（可横滑 / 收起） -->
    <CategoryBar
      v-model="category"
      :categories="allCategories"
      :collapsed="catCollapsed"
      @toggle="catCollapsed = !catCollapsed"
    />

    <!-- 样式条（可折叠） -->
    <StyleBar v-model:style="style" :collapsed="styleBarCollapsed" @toggle="styleBarCollapsed = !styleBarCollapsed" />

    <!-- 别名命中提示（F1.3） -->
    <div v-if="aliasHit" class="alias-tip">
      旧名 <code>{{ query }}</code> 已改名为 <b>{{ aliasHit }}</b>
    </div>

    <!-- 图标网格（虚拟滚动） -->
    <div class="grid-area">
      <IconGrid :icons="visibleIcons" :style="style" @clear-filters="clearFilters" />
    </div>

    <!-- 底部版本信息（F4.2） -->
    <footer class="foot">
      <span>{{ totalCount }} 个图标 · lucide {{ version.sha }}</span>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CategoryBar from './components/CategoryBar.vue'
import StyleBar from './components/StyleBar.vue'
import IconGrid from './components/IconGrid.vue'
import { categories, dataVersion, iconCount, searchIcons } from '@lib/icons'
import type { IconEntry } from '@lib/icons'
import { loadStyle, loadUi, saveStyle, saveUi } from '@lib/store'
import type { StyleState } from '@lib/store'
import { PluginMessage } from '@messages/sender'

const query = ref('')
const category = ref('all')
const catCollapsed = ref(false)
const styleBarCollapsed = ref(false)
const style = ref<StyleState>(loadStyle())
const aliasHit = ref<string | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

const version = dataVersion()
const allCategories = categories()
const totalCount = iconCount()

// 上次会话的分类/折叠状态（F3.4）
const savedUi = loadUi()
category.value = savedUi.category
catCollapsed.value = savedUi.categoryCollapsed ?? false
styleBarCollapsed.value = savedUi.styleBarCollapsed

const visibleIcons = computed<IconEntry[]>(() => {
  const result = searchIcons({ query: query.value, category: category.value })
  aliasHit.value = result.aliasHit
  return result.icons
})

/** F1.5：无结果时一键清空筛选 */
function clearFilters(): void {
  query.value = ''
  category.value = 'all'
  if (searchEl.value) searchEl.value.focus()
}

// 样式与界面状态变化 → 持久化（F3.4）
watch(
  style,
  (val) => {
    saveStyle({ ...val })
  },
  { deep: true }
)

watch(
  () => [category.value, catCollapsed.value, styleBarCollapsed.value],
  () => {
    saveUi({
      category: category.value,
      styleBarCollapsed: styleBarCollapsed.value,
      categoryCollapsed: catCollapsed.value,
    })
  }
)

// 主线程错误回传（用于调试）
function handlePluginMessage(event: MessageEvent): void {
  const msg = event.data as { type?: string; data?: unknown } | null
  if (!msg || !msg.type) return
  if (msg.type === PluginMessage.ERROR) {
    console.error('[Lucide 插件] 主线程报错', msg.data)
  }
}

onMounted(() => {
  window.onmessage = handlePluginMessage
  // 首次挂载聚焦搜索框
  if (searchEl.value) searchEl.value.focus()
})

onBeforeUnmount(() => {
  window.onmessage = null
})
</script>

<style scoped>
.wrap {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 8px 8px 0;
  background: #ffffff;
  color: #2c2c2a;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
.top {
  padding-bottom: 8px;
}
.search {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #d3d1c7;
  border-radius: 7px;
  background: #ffffff;
  color: #2c2c2a;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.search:focus {
  border-color: #185fa5;
}
.alias-tip {
  padding: 5px 8px;
  border-radius: 6px;
  background: #eef3fb;
  color: #3c5d87;
  font-size: 12px;
}
.alias-tip b {
  font-weight: 600;
}
.grid-area {
  flex: 1;
  min-height: 0;
  margin-top: 8px;
}
.foot {
  padding: 6px 2px 8px;
  color: #888780;
  font-size: 11px;
  text-align: right;
}
</style>