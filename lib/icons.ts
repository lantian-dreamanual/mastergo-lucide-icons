/**
 * Lucide 图标库数据层：加载紧凑数据集、建索引、搜索。
 *
 * 索引设计依据（PRD 附录 B.4 实测）：
 *  - 名字与自身 tags 重叠 83% 为零 → 名字索引与 tag 索引必须同时建、缺一不可
 *  - 官方旧名 aliases 264 个全部 deprecated → 必须并入搜索，命中时提示「已改名为 xxx」（F1.3）
 *  - 搜索维度：图标名（- 分词 + 子串）、官方 tag、分类名、aliases；搜索与分类叠加取交集（F1.4）
 *  - 中文搜索（M2-A）：中文词 → 词典查英文候选词 → 走既有名字/tag 索引 → 合并去重
 *
 * 本文件不依赖 mg，UI 侧与（如需）主线程均可复用。
 */

import dataset from '../data/lucide-icons.json'
import zhDictRaw from '../data/zh-dict.json'
import type { IconNode } from './svg'

/** 中文搜索词典（M2-A）：中文词 → 英文词数组 */
const zhDict = zhDictRaw as Record<string, string[]>

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
  'home': '主页',
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

/** 获取分类的中文显示名（无映射时回退到英文 title） */
export function categoryZhTitle(catId: string): string {
  return categoryZhMap[catId] ?? ''
}

/** 获取分类的双语显示名（如「文本格式 Text formatting」） */
export function categoryDisplayName(cat: CategoryInfo): string {
  const zh = categoryZhMap[cat.id]
  return zh ? `${zh} ${cat.title}` : cat.title
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
  categories: CategoryInfo[]
  /** 图标名 → 在 entries 中的下标 */
  nameToIndex: Map<string, number>
  /** tag 词 → 图标下标集合 */
  tagToIndices: Map<string, Set<number>>
  /** 分类 id → 图标下标集合 */
  catToIndices: Map<string, Set<number>>
  /** 别名 → 现名 */
  aliases: Map<string, string>
}

const raw = dataset as unknown as {
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
  const nameToIndex = new Map<string, number>()
  const tagToIndices = new Map<string, Set<number>>()
  const catToIndices = new Map<string, Set<number>>()

  for (let i = 0; i < raw.names.length; i++) {
    const name = raw.names[i]
    const nodes = raw.nodes[i]
    const catIds = raw.cats[i] ?? []
    entries.push({ name, nodes, catIds })
    nameToIndex.set(name, i)

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

  return {
    entries,
    names: raw.names,
    categories: raw.catList,
    nameToIndex,
    tagToIndices,
    catToIndices,
    aliases,
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
  const idx = getIndex().nameToIndex.get(name)
  return idx === undefined ? undefined : getIndex().entries[idx]
}

/** 名字分词：按 - 与空白拆分，保留子串匹配能力 */
function tokenizeName(name: string): string[] {
  return name.split(/[-_\s]+/).filter(Boolean)
}

/** 检测字符串是否包含中文字符 */
function containsChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s)
}

/**
 * 中文查询 → 英文候选词数组（M2-A）。
 * 策略：精确匹配 key + 子串匹配（query 包含 key 或 key 包含 query）。
 */
function chineseToEnglish(query: string): string[] {
  const trimmed = query.trim()
  const words: string[] = []

  // 精确匹配
  const exact = zhDict[trimmed]
  if (exact) words.push(...exact)

  // 子串匹配（跳过已精确匹配的 key）
  for (const [key, vals] of Object.entries(zhDict)) {
    if (key === trimmed) continue
    if (key.includes(trimmed) || trimmed.includes(key)) {
      words.push(...vals)
    }
  }

  return [...new Set(words)]
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
  let candidates: number[]
  if (cat === 'all') {
    candidates = index.entries.map((_, i) => i)
  } else {
    const set = index.catToIndices.get(cat)
    candidates = set ? Array.from(set) : []
  }

  if (!q) {
    return {
      icons: candidates.map((i) => index.entries[i]),
      aliasHit: null,
    }
  }

  const matched = new Set<number>()
  let aliasHit: string | null = null

  // 中文搜索（M2-A）：查词典得英文候选词 → 走名字/tag 索引
  if (containsChinese(q)) {
    const englishWords = chineseToEnglish(q)
    for (const word of englishWords) {
      const w = word.toLowerCase()
      // 名字子串 + 分词匹配
      for (const i of candidates) {
        if (matched.has(i)) continue
        const name = index.entries[i].name.toLowerCase()
        if (name.includes(w)) {
          matched.add(i)
          continue
        }
        const parts = tokenizeName(index.entries[i].name)
        if (queryPartsMatch(parts, w)) {
          matched.add(i)
        }
      }
      // tag 索引
      const tagSet = index.tagToIndices.get(w)
      if (tagSet) {
        for (const i of tagSet) {
          if (candidates.includes(i)) matched.add(i)
        }
      }
    }
  }

  // 名字子串 + 分词匹配
  for (const i of candidates) {
    const name = index.entries[i].name
    const lower = name.toLowerCase()
    if (lower.includes(q)) {
      matched.add(i)
      continue
    }
    // 分词：query 的每一段都必须是名字某个分词的子串（按序不强求，宽松匹配）
    const parts = tokenizeName(name)
    const allPartMatch = queryPartsMatch(parts, q)
    if (allPartMatch) {
      matched.add(i)
      continue
    }
    // 别名：命中即认为该图标可搜到，并提示「已改名为 xxx」
    const aliasTarget = index.aliases.get(q)
    if (aliasTarget && aliasTarget === name) {
      matched.add(i)
      aliasHit = aliasTarget
    }
  }

  // tag 维度
  const tagSet = index.tagToIndices.get(q)
  if (tagSet) {
    for (const i of tagSet) {
      if (candidates.includes(i)) matched.add(i)
    }
  }

  // 分类名维度：分类 title 命中时，把该分类下所有图标加入
  const catHit = index.categories.find((c) => c.title.toLowerCase().includes(q))
  if (catHit) {
    const set = index.catToIndices.get(catHit.id)
    if (set) {
      for (const i of set) {
        if (candidates.includes(i)) matched.add(i)
      }
    }
  }

  return {
    icons: Array.from(matched).map((i) => index.entries[i]),
    aliasHit,
  }
}

/** 分词匹配：query 的每个 token 都必须在名字的某个分词中被包含 */
function queryPartsMatch(parts: string[], query: string): boolean {
  const tokens = query.split(/[-_\s]+/).filter(Boolean)
  if (!tokens.length) return false
  return tokens.every((token) => parts.some((p) => p.toLowerCase().includes(token)))
}