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
      <CategoryBar v-model="category" :categories="allCategories" />

      <!-- 右侧内容区 -->
      <div class="main">
        <!-- 样式条（可折叠） -->
        <StyleBar
          v-model:style="style"
          :collapsed="styleBarCollapsed"
          @toggle="styleBarCollapsed = !styleBarCollapsed"
        />

        <!-- 别名命中提示（F1.3） -->
        <div v-if="aliasHit" class="alias-tip">
          旧名 <code>{{ query }}</code> 已改名为 <b>{{ aliasHit }}</b>
        </div>

        <!-- 图标网格（虚拟滚动） -->
        <div class="grid-area">
          <IconGrid :icons="visibleIcons" :style="style" @clear-filters="clearFilters" />
        </div>

        <!-- 底部版本信息（F4.2） -->
        <footer class="foot">{{ versionLabel }}</footer>
      </div>
    </div>

    <!-- 导入结果提示：成功轻提示、失败明确原因（M1 审核 P0-2） -->
    <div class="toasts" aria-live="polite">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">
        <span class="toast-text">{{ toast.text }}</span>
        <button class="toast-close" type="button" aria-label="关闭提示" @click="dismiss(toast.id)">
          ×
        </button>
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
import { DEFAULT_STYLE, DEFAULT_UI, preferredIconColor, sanitizePersisted } from '@lib/store'
import type { PersistedState, StyleState } from '@lib/store'
import {
  PluginMessage,
  sendMsgToPlugin,
  UIMessage,
  type InsertResult,
  type StateLoadedPayload,
} from '@messages/sender'

/**
 * 图标默认色 = 当前面板主题的反色（深色面板 → 白，浅色面板 → 黑）。
 *
 * ⚠️ 必须在这里求值一次并复用到读盘，不能让「初始值」和「读盘兜底」各算一遍：
 *    面板首次打开时读盘返回的是空状态，色值会由 `sanitizePersisted` 的兜底决定 ——
 *    如果那里用了静态默认值，主题反色就白算了（用户仍会看到看不见的图标）。
 */
const fallbackIconColor = preferredIconColor()

const query = ref('')
const style = ref<StyleState>({ ...DEFAULT_STYLE, color: fallbackIconColor })
const category = ref<string>(DEFAULT_UI.category)
const styleBarCollapsed = ref<boolean>(DEFAULT_UI.styleBarCollapsed)
const searchEl = ref<HTMLInputElement | null>(null)

const version = dataVersion()
const allCategories = categories()
const totalCount = iconCount()
const categoryIds = ['all', ...allCategories.map((c) => c.id)]

// ===== 派生数据 =====

/**
 * 搜索结果是唯一数据源，别名提示从同一结果派生。
 * ⚠️ 别把赋值写进 computed 里（之前是 `visibleIcons` 内部顺手 `aliasHit.value = ...`）——
 *    computed 应当是纯的，副作用会带来难查的重复求值和时序问题。
 */
const searchResult = computed(() => searchIcons({ query: query.value, category: category.value }))
const visibleIcons = computed(() => searchResult.value.icons)
const aliasHit = computed(() => searchResult.value.aliasHit)

/** 底部信息行：第三方许可署名（ISC 要求随副本出现）+ 数据集版本，可回溯到具体上游快照 */
const versionLabel = computed(() => {
  const parts = [`图标来自 Lucide (ISC)`]
  if (version?.sha) parts.push(`main@${version.sha}`)
  parts.push(`${totalCount} 个图标`)
  return parts.join(' · ')
})

/** F1.5：无结果时一键清空筛选 */
function clearFilters(): void {
  query.value = ''
  category.value = 'all'
  if (searchEl.value) searchEl.value.focus()
}

// ===== 导入结果提示 =====

interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
}

const toasts = ref<Toast[]>([])
let toastSeq = 0
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
  const timer = toastTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    toastTimers.delete(id)
  }
}

function pushToast(kind: Toast['kind'], text: string, duration: number): void {
  // 连续插入时不要堆一屏「已插入」——同类型的成功提示只保留最新一条
  if (kind === 'ok') {
    for (const old of toasts.value.filter((t) => t.kind === 'ok')) dismiss(old.id)
  }
  const id = ++toastSeq
  toasts.value = [...toasts.value, { id, kind, text }]
  toastTimers.set(
    id,
    setTimeout(() => dismiss(id), duration)
  )
}

// ===== 与主线程通信 =====

function handlePluginMessage(event: MessageEvent): void {
  const msg = event.data as { type?: string; data?: unknown } | null
  if (!msg || !msg.type) return

  if (msg.type === PluginMessage.INSERT_RESULT) {
    const result = msg.data as InsertResult | null
    if (!result) return
    if (result.ok) {
      pushToast('ok', `已插入「${result.name}」`, 1600)
    } else {
      // 失败必须让用户看见：这是 M1 审核里的 P0-2，之前失败是完全静默的
      pushToast('error', result.error ?? `「${result.name}」导入失败，请重试`, 6000)
      if (result.errorDetail) console.error('[Lucide 插件] 导入失败详情', result.errorDetail)
    }
    return
  }

  if (msg.type === PluginMessage.ERROR) {
    const data = msg.data as { message?: string } | null
    pushToast('error', data?.message ?? '插件执行出错，请重试', 6000)
    console.error('[Lucide 插件] 主线程报错', msg.data)
    return
  }

  if (msg.type === PluginMessage.STATE_LOADED) {
    const payload = msg.data as StateLoadedPayload | null
    applyPersisted(payload?.state)
  }
}

// ===== 持久化（F3.4）：UI 侧没有可用的存储，统一经主线程走 clientStorage =====

/** 用户在读盘回来前已经改过参数 → 别用存储里的旧值覆盖他的操作 */
let userTouched = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function applyPersisted(rawState: unknown): void {
  if (userTouched) return
  const restored = sanitizePersisted(rawState, categoryIds, fallbackIconColor)
  style.value = restored.style
  category.value = restored.ui.category
  styleBarCollapsed.value = restored.ui.styleBarCollapsed
}

function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const payload: PersistedState = {
    style: { ...style.value },
    ui: { category: category.value, styleBarCollapsed: styleBarCollapsed.value },
  }
  sendMsgToPlugin({ type: UIMessage.SAVE_STATE, data: payload })
}

/** 拖动滑块会连续触发，节流后再落盘 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 300)
}

watch(
  style,
  () => {
    userTouched = true
    scheduleSave()
  },
  { deep: true }
)

watch([category, styleBarCollapsed], () => {
  userTouched = true
  scheduleSave()
})

onMounted(() => {
  window.onmessage = handlePluginMessage
  // 请求上次持久化的状态（主线程读 clientStorage 后回 STATE_LOADED）
  sendMsgToPlugin({ type: UIMessage.LOAD_STATE })
  if (searchEl.value) searchEl.value.focus()
})

onBeforeUnmount(() => {
  window.onmessage = null
  // 关面板前把待写的参数落盘（否则节流窗口内的最后一次调整会丢）
  if (saveTimer) flushSave()
  for (const timer of toastTimers.values()) clearTimeout(timer)
  toastTimers.clear()
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

  position: relative;
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

/*
 * 暗色模式：只跟随「系统级」配色偏好。
 *
 * ⚠️ MasterGo 客户端内部的亮暗切换**感知不到** —— themechange / themeColor 这两个
 *    官方 typings 里存在的 API 实测不生效（此前尝试跟随并已回退）。所以：
 *      系统深色 → 面板深色；系统浅色而 MasterGo 深色 → 面板仍是浅色。
 *    这段是真实生效的 CSS，不是死代码；但改之前请先实机验证，别照着「应该能跟随」写。
 */
@media (prefers-color-scheme: dark) {
  .wrap {
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 导入结果提示 =====
 * 四边内缩统一 8px：与搜索框、网格的内边距同值，视觉上贴着面板边缘。
 * 提示是带阴影的浮层，短暂盖住底部的版本行是预期行为（原先为了避开它写成 30px，
 * 反而像悬在半空 —— 用户 2026-09-15 反馈）。
 */
.toasts {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 10;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--mg-radius-sm);
  border: 1px solid var(--mg-border);
  background: var(--mg-bg-elevated);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  pointer-events: auto;
}
.toast-text {
  flex: 1;
  min-width: 0;
  line-height: 1.45;
  word-break: break-word;
}
.toast.ok {
  border-color: rgba(54, 112, 247, 0.35);
  color: var(--mg-text);
}
.toast.error {
  border-color: rgba(209, 67, 58, 0.5);
  color: #b3352a;
}
@media (prefers-color-scheme: dark) {
  .toast.error {
    color: #f08b80;
  }
}
.toast-close {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--mg-text-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.toast-close:hover {
  color: var(--mg-text);
}
</style>
