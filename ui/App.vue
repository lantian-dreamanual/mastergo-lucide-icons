<template>
  <div class="wrap">
    <!-- 顶部：搜索框 -->
    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref="searchEl"
        v-model="query"
        type="text"
        placeholder="搜索图标名 / 关键词 / 中文"
        class="search"
        @keydown.esc="query = ''"
      />
    </div>

    <!-- 主体：左栏分类 + 右侧内容 -->
    <div class="body">
      <!-- 左栏分类（外卖 app 式纵向列表） -->
      <CategoryBar
        v-model="category"
        :categories="allCategories"
      />

      <!-- 右侧内容区 -->
      <div class="main">
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

        <!-- 底部版本信息（F4.2 + M2-B） -->
        <footer class="foot">
          <span>{{ totalCount }} 个图标 · lucide {{ version.sha }} · {{ updateDate }}</span>
        </footer>
      </div>
    </div>
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
const styleBarCollapsed = ref(false)
const style = ref<StyleState>(loadStyle())
const aliasHit = ref<string | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

const version = dataVersion()
const allCategories = categories()
const totalCount = iconCount()

/** M2-B：底部版本信息显示上游更新日期（取 upstreamDate 的日期部分） */
const updateDate = computed(() => {
  const d = version.upstreamDate
  if (!d) return ''
  return d.slice(0, 10) + ' 更新'
})

// 上次会话的分类/折叠状态（F3.4）
const savedUi = loadUi()
category.value = savedUi.category
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
  () => [category.value, styleBarCollapsed.value],
  () => {
    saveUi({
      category: category.value,
      styleBarCollapsed: styleBarCollapsed.value,
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
/* ===== MasterGo 设计系统 CSS 变量 ===== */
.wrap {
  --mg-bg: #fafafa;
  --mg-bg-elevated: #ffffff;
  --mg-bg-hover: #f0f0f0;
  --mg-bg-active: #e6e6e6;
  --mg-border: #e5e3db;
  --mg-border-light: #f0f0f0;
  --mg-text: #343434;
  --mg-text-secondary: #888780;
  --mg-text-tertiary: #b0aea6;
  --mg-primary: #3670f7;
  --mg-primary-bg: #eef3fb;
  --mg-primary-hover: #2b5cd9;
  --mg-radius-sm: 6px;
  --mg-radius-md: 8px;

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--mg-bg);
  color: var(--mg-text);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}

/* 暗色模式：MasterGo 通过 html.dark 切换 */
:global(html.dark) .wrap {
  --mg-bg: #212121;
  --mg-bg-elevated: #333333;
  --mg-bg-hover: #3c3c3c;
  --mg-bg-active: #404040;
  --mg-border: #3c3c3c;
  --mg-border-light: #2e2e2e;
  --mg-text: #d9d9d9;
  --mg-text-secondary: #8c8c8c;
  --mg-text-tertiary: #5c5c5c;
  --mg-primary: #2b5cd9;
  --mg-primary-bg: rgba(43, 92, 217, 0.12);
  --mg-primary-hover: #3762ec;
}

/* ===== 搜索框 ===== */
.search-wrap {
  position: relative;
  padding: 8px 8px;
}
.search-icon {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--mg-text-tertiary);
  pointer-events: none;
  z-index: 1;
}
.search {
  width: 100%;
  padding: 6px 10px 6px 30px;
  border: 1px solid var(--mg-border);
  border-radius: var(--mg-radius-sm);
  background: var(--mg-bg-elevated);
  color: var(--mg-text);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.search::placeholder {
  color: var(--mg-text-tertiary);
}
.search:focus {
  border-color: var(--mg-primary);
}

/* ===== 主体布局 ===== */
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ===== 右侧内容区 ===== */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ===== 别名提示 ===== */
.alias-tip {
  padding: 4px 10px;
  background: var(--mg-primary-bg);
  color: var(--mg-primary);
  font-size: 11px;
  border-bottom: 1px solid var(--mg-border-light);
}
.alias-tip code {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 11px;
}
.alias-tip b {
  font-weight: 600;
}

/* ===== 图标网格区域 ===== */
.grid-area {
  flex: 1;
  min-height: 0;
}

/* ===== 底部版本信息 ===== */
.foot {
  padding: 4px 10px;
  border-top: 1px solid var(--mg-border-light);
  color: var(--mg-text-tertiary);
  font-size: 10px;
  text-align: right;
}
</style>
