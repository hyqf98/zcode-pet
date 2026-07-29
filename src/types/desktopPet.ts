// 桌面宠物相关的前端类型定义（镜像后端 src-tauri/src/commands/desktop_pet.rs 的结构）。

/** codex-pets.net 市场上的单只宠物摘要（列表项 / 详情项）。 */
export interface CodexPetSummary {
  id: string
  displayName: string
  description?: string | null
  kind?: string | null
  tags: string[]
  spritesheetUrl?: string | null
  posterUrl?: string | null
  previewUrl?: string | null
  shareImageUrl?: string | null
  viewCount?: number | null
  downloadCount?: number | null
  likeCount?: number | null
  uploadedAt?: string | null
}

/** 市场列表接口的分页信封。 */
export interface CodexPetListResponse {
  pets: CodexPetSummary[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** 市场排序方式（与后端 sort 参数一致）。 */
export type CodexPetSort = 'new' | 'popular' | 'views' | 'discussed' | 'random'

/** 市场分类筛选（与后端 kind 参数一致）。 */
export type CodexPetKind = 'object' | 'animal' | 'person' | 'creature'

/** 本地已安装的宠物信息（后端透出，含绝对路径便于 convertFileSrc）。 */
export interface LocalPetInfo {
  id: string
  displayName: string
  description?: string | null
  kind?: string | null
  tags: string[]
  /** 'builtin'（内置打包）、'downloaded'（市场下载）、'uploaded'（本地导入图片）或 'imported'（codex manifest 包）。 */
  source: 'builtin' | 'downloaded' | 'uploaded' | 'imported' | string
  /** 精灵图绝对路径（前端用 convertFileSrc 转成可加载 URL）。 */
  spritesheetPath: string
  posterPath?: string | null
  spritesheetUrl?: string | null
  version?: number | null
  /** 精灵图版本号：1=标准 9 行图集，2=扩展 11 行图集。缺省时由渲染层按图集高度推断。 */
  spriteVersionNumber?: number | null
  installedAt?: string | null
}

/** 市场搜索参数。 */
export interface CodexPetSearchParams {
  q?: string
  kind?: CodexPetKind | ''
  sort?: CodexPetSort
  page?: number
  pageSize?: number
}

// --- 市场网络代理 ----------------------------------------------------------

/** 代理模式：auto（自动检测/Clash 默认）/ direct（直连）/ custom（自定义 URL）。 */
export type ProxyMode = 'auto' | 'direct' | 'custom'

/** 代理配置（镜像后端 ProxyConfig，camelCase）。 */
export interface ProxyConfig {
  mode: ProxyMode
  customUrl: string
}

/** 市场连接测试结果。 */
export interface MarketConnectionResult {
  ok: boolean
  latencyMs?: number | null
  error?: string | null
  proxyUsed?: string | null
}
