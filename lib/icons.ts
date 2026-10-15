/**
 * Lucide 图标库数据层：加载紧凑数据集、建索引、搜索。
 *
 * 索引设计依据（PRD 附录 B.4 实测）：
 *  - 名字与自身 tags 重叠 83% 为零 → 名字索引与 tag 索引必须同时建、缺一不可
 *  - 官方旧名 aliases 264 个全部 deprecated → 必须并入搜索，命中时提示「已改名为 xxx」（F1.3）
 *  - 搜索维度：图标名（- 分词 + 子串）、官方 tag、分类名、aliases；搜索与分类叠加取交集（F1.4）
 *  - 中文搜索（方案 A）：每个图标直接挂中文关键词（data/icon-zh.json，scripts/gen-icon-zh.py 生成），
 *    中文 query 与关键词匹配即命中；运行时零联网，数据全部内置 bundle
 *
 * 性能约定：所有「按名字」的重复计算（小写化、分词）都在 buildIndex 时预计算，
 * 搜索热路径里只做比较，不做字符串切分 —— 输入框是逐字触发的，这个差别很实际。
 *
 * 本文件不依赖 mg，UI 侧与（如需）主线程均可复用。
 */

import { ungzip } from 'pako'
import { DATASET_GZ_B64, ICON_ZH_GZ_B64 } from '../data/compressed'
import type { IconNode } from './svg'

/**
 * 数据加载（2026-10-15 起改为构建期 gzip + base64，运行时解压）：
 * 上线版面板的打开速度与 dist/index.html 体积直接相关（MasterGo 服务器整包下发），
 * 且 CJK 在 esbuild 输出里被 \uXXXX 转义、体积翻倍。压成 gzip+base64 后
 * 数据集 535KB→165KB、中文词 164KB→48KB。同步解压耗时几十 ms，可忽略。
 */
function inflateJson(b64: string): unknown {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return JSON.parse(new TextDecoder().decode(ungzip(bytes)))
}

/** 每图标的中文关键词（方案 A）：图标名 → 中文词数组 */
const iconZh = inflateJson(ICON_ZH_GZ_B64) as Record<string, string[]>

/** 42 分类的中文显示名（M2-A：分类条双语显示） */
const categoryZhMap: Record<string, string> = {
  'text': '文本格式',
  'design': '设计',
  'accessibility': '无障碍',
  'medical': '医疗',
  'account': '账户与访问',
  'social': '社交',
  'science': '科学',
  'multimedia': '多媒体',
  'notifications': '通知',
  'home': '家居',
  'connectivity': '连接',
  'devices': '设备',
  'time': '时间与日历',
  'travel': '旅行',
  'layout': '布局',
  'transportation': '交通',
  'development': '编程与开发',
  'food-beverage': '餐饮',
  'gaming': '游戏',
  'math': '数学',
  'communication': '通信',
  'buildings': '建筑',
  'tools': '工具',
  'photography': '摄影',
  'files': '文件',
  'mail': '邮件',
  'arrows': '箭头',
  'shapes': '形状',
  'sports': '运动',
  'people': '人物',
  'shopping': '购物',
  'finance': '金融',
  'emoji': '表情',
  'navigation': '导航与地点',
  'nature': '自然',
  'animals': '动物',
  'security': '安全',
  'weather': '天气',
  'charts': '图表',
  'cursors': '光标',
  'sustainability': '可持续发展',
  'seasons': '季节',
}

/**
 * 取分类的中文显示名。**未覆盖时返回空串**，调用方需自行回退到官方英文 `title`。
 *
 * ⚠️ 不要对返回值做 `split(' ')[0]` 之类的截断 —— 上游新增分类而这里没跟进时，
 *    空串截断仍为空串还算安全，但一旦有人改成「先拼中英再截断」，就会把
 *    `Food & Beverage` 显示成 `Food`。取中文一律走本函数，取英文一律用 `cat.title`。
 */
export function categoryZhTitle(catId: string): string {
  return categoryZhMap[catId] ?? ''
}

/** 数据集版本信息（PRD F4.2：面板底部展示） */
export interface DataVersion {
  sha: string
  fullSha: string
  upstreamDate: string
  generatedAt: string
}

/** 单个图标的可搜索信息（紧凑索引条目） */
export interface IconEntry {
  /** 图标名（如 house） */
  name: string
  /** 渲染节点（同源 buildSvg 的输入） */
  nodes: IconNode[]
  /** 所属分类 id 列表 */
  catIds: number[]
}

export interface CategoryInfo {
  id: string
  title: string
}

export interface SearchOptions {
  /** 搜索关键词（可为空） */
  query: string
  /** 分类筛选：分类 id；'all' 表示全部 */
  category: string
}

export interface SearchResult {
  /** 命中的图标条目（已按分类过滤） */
  icons: IconEntry[]
  /** 本次搜索是否命中了别名（命中时 UI 提示「已改名为 xxx」） */
  aliasHit: string | null
}

interface BuiltIndex {
  entries: IconEntry[]
  names: string[]
  /** 预计算的小写名字（热路径反复用） */
  namesLower: string[]
  /** 预计算的小写分词 */
  nameTokens: string[][]
  categories: CategoryInfo[]
  /** 图标名 → 在 entries 中的下标 */
  nameToIndex: Map<string, number>
  /** tag 词 → 图标下标集合 */
  tagToIndices: Map<string, Set<number>>
  /** 分类 id → 图标下标集合 */
  catToIndices: Map<string, Set<number>>
  /** 别名 → 现名 */
  aliases: Map<string, string>
  /** 中文词 → 图标下标集合（方案 A：关键词倒排） */
  zhToIndices: Map<string, Set<number>>
}

const raw = inflateJson(DATASET_GZ_B64) as unknown as {
  version: DataVersion
  count: number
  names: string[]
  nodes: IconNode[][]
  tagDict: string[]
  tags: number[][]
  catList: CategoryInfo[]
  cats: number[][]
  aliases: Record<string, string>
}

/** 预构建的索引（模块级单例，首次调用时构建） */
let indexCache: BuiltIndex | null = null

function buildIndex(): BuiltIndex {
  const entries: IconEntry[] = []
  const namesLower: string[] = []
  const nameTokens: string[][] = []
  const nameToIndex = new Map<string, number>()
  const tagToIndices = new Map<string, Set<number>>()
  const catToIndices = new Map<string, Set<number>>()

  for (let i = 0; i < raw.names.length; i++) {
    const name = raw.names[i]
    const nodes = raw.nodes[i]
    const catIds = raw.cats[i] ?? []
    entries.push({ name, nodes, catIds })
    nameToIndex.set(name, i)
    namesLower.push(name.toLowerCase())
    nameTokens.push(tokenizeName(name))

    // tag 索引（官方 tag 词 → 图标）
    const tagIds = raw.tags[i] ?? []
    for (const tid of tagIds) {
      const word = raw.tagDict[tid]
      let set = tagToIndices.get(word)
      if (!set) {
        set = new Set()
        tagToIndices.set(word, set)
      }
      set.add(i)
    }

    // 分类索引
    for (const cid of catIds) {
      const cat = raw.catList[cid]
      if (!cat) continue
      let set = catToIndices.get(cat.id)
      if (!set) {
        set = new Set()
        catToIndices.set(cat.id, set)
      }
      set.add(i)
    }
  }

  const aliases = new Map<string, string>()
  for (const [alias, target] of Object.entries(raw.aliases)) {
    aliases.set(alias, target)
  }

  // 中文关键词倒排（方案 A）：中文词 → 图标下标集合
  const zhToIndices = new Map<string, Set<number>>()
  for (let i = 0; i < raw.names.length; i++) {
    const words = iconZh[raw.names[i]]
    if (!words) continue
    for (const w of words) {
      let set = zhToIndices.get(w)
      if (!set) {
        set = new Set()
        zhToIndices.set(w, set)
      }
      set.add(i)
    }
  }

  return {
    entries,
    names: raw.names,
    namesLower,
    nameTokens,
    categories: raw.catList,
    nameToIndex,
    tagToIndices,
    catToIndices,
    aliases,
    zhToIndices,
  }
}

/** 获取（并缓存）索引 */
export function getIndex(): BuiltIndex {
  if (!indexCache) indexCache = buildIndex()
  return indexCache
}

/** 图标总数（PRD F4.2 展示用） */
export function iconCount(): number {
  return getIndex().entries.length
}

/** 数据版本信息 */
export function dataVersion(): DataVersion {
  return raw.version
}

/** 全部分类（含「全部」占位由 UI 自行处理） */
export function categories(): CategoryInfo[] {
  return getIndex().categories
}

/** 按名字取图标（拖拽/点击导入时用） */
export function iconByName(name: string): IconEntry | undefined {
  const index = getIndex()
  const idx = index.nameToIndex.get(name)
  return idx === undefined ? undefined : index.entries[idx]
}

/** 名字分词：按 - 与空白拆分并小写，保留子串匹配能力 */
function tokenizeName(name: string): string[] {
  return name.toLowerCase().split(/[-_\s]+/).filter(Boolean)
}

/** 检测字符串是否包含中文字符 */
function containsChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s)
}

/**
 * 中文 query → 命中的中文关键词（方案 A）。
 * 策略：精确匹配 key + 子串匹配（query 包含 key 或 key 包含 query），
 * 与旧词典版一致，保证「网口」能带出「网口」「网端口」这类变形。
 */
function matchZhWords(query: string): string[] {
  const index = getIndex()
  const trimmed = query.trim()
  const words: string[] = []

  for (const key of index.zhToIndices.keys()) {
    if (key === trimmed) {
      words.push(key)
      continue
    }
    // 子串匹配仅对双字及以上的词开放：单字词（山/日/门）参与子串会把
    // 「过山车」放大成整座山系，噪声远大于收益
    if (key.length >= 2 && trimmed.length >= 2 && (key.includes(trimmed) || trimmed.includes(key))) {
      words.push(key)
    }
  }

  return words
}

/**
 * 核心搜索：
 *  - query 为空 → 只按分类过滤
 *  - query 命中图标名子串（含 - 分词）、官方 tag、分类名、aliases 任一维度即命中
 *  - 分类筛选叠加生效（交集，F1.4）
 *  - 命中别名时返回 aliasHit 供 UI 提示「已改名为 xxx」（F1.3）
 */
export function searchIcons(options: SearchOptions): SearchResult {
  const index = getIndex()
  const q = options.query.trim().toLowerCase()
  const cat = options.category

  // 分类过滤：先收拢候选集合
  const isAllCategories = cat === 'all'
  const candidates: number[] = isAllCategories
    ? index.entries.map((_, i) => i)
    : Array.from(index.catToIndices.get(cat) ?? [])

  // O(1) 归属判定。之前用 candidates.includes() 是 O(n²)：
  // 「全部」视图下每个命中图标都要线性扫 1847 个下标，一次搜索上百万次比较。
  const candidateSet = isAllCategories ? null : new Set(candidates)
  const inCategory = (i: number): boolean => candidateSet === null || candidateSet.has(i)

  if (!q) {
    return {
      icons: candidates.map((i) => index.entries[i]),
      aliasHit: null,
    }
  }

  const matched = new Set<number>()
  let aliasHit: string | null = null

  // 中文搜索（方案 A）：直接匹配每图标的中文关键词（倒排索引，O(命中词数)）
  if (containsChinese(q)) {
    for (const word of matchZhWords(q)) {
      const set = index.zhToIndices.get(word)
      if (!set) continue
      for (const i of set) {
        if (inCategory(i)) matched.add(i)
      }
    }
  }

  // 名字子串 + 分词匹配
  for (const i of candidates) {
    if (index.namesLower[i].includes(q) || queryPartsMatch(index.nameTokens[i], q)) {
      matched.add(i)
    }
  }

  // tag 维度
  const tagSet = index.tagToIndices.get(q)
  if (tagSet) {
    for (const i of tagSet) {
      if (inCategory(i)) matched.add(i)
    }
  }

  // 别名维度：官方旧名（264 个，均标记 deprecated）→ 命中现名并提示「已改名」
  // 提到循环外只查一次，不必对每个候选图标重复查同一个 key
  const aliasTarget = index.aliases.get(q)
  if (aliasTarget) {
    const aliasIndex = index.nameToIndex.get(aliasTarget)
    if (aliasIndex !== undefined && inCategory(aliasIndex)) {
      matched.add(aliasIndex)
      aliasHit = aliasTarget
    }
  }

  // 分类名维度：分类 title 命中时，把该分类下所有图标加入
  const catHit = index.categories.find((c) => c.title.toLowerCase().includes(q))
  if (catHit) {
    const set = index.catToIndices.get(catHit.id)
    if (set) {
      for (const i of set) {
        if (inCategory(i)) matched.add(i)
      }
    }
  }

  return {
    icons: Array.from(matched).map((i) => index.entries[i]),
    aliasHit,
  }
}

/**
 * 分词匹配：query 的每个 token 都必须在名字的某个分词中被包含。
 * `parts` 与 `query` 都必须已小写（parts 在 buildIndex 时预计算）。
 */
function queryPartsMatch(parts: string[], query: string): boolean {
  const tokens = query.split(/[-_\s]+/).filter(Boolean)
  if (!tokens.length) return false
  return tokens.every((token) => parts.some((p) => p.includes(token)))
}
