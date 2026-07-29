// 桌面宠物 IPC 封装。所有调用走 invoke（与项目其余 IPC 调用一致），返回 Promise。
//
// 后端命令定义在 src-tauri/src/commands/desktop_pet.rs，统一 camelCase 序列化。

import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import type {
  CodexPetListResponse,
  CodexPetSearchParams,
  CodexPetSummary,
  LocalPetInfo,
  MarketConnectionResult,
  ProxyConfig
} from '@/types/desktopPet'

/** 搜索 codex-pets.net 宠物市场。 */
export async function searchCodexPets(
  params: CodexPetSearchParams = {}
): Promise<CodexPetListResponse> {
  return invoke<CodexPetListResponse>('search_codex_pets', {
    q: params.q ?? null,
    kind: params.kind || null,
    sort: params.sort ?? null,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 30
  })
}

/** 获取单只宠物的详情（含完整精灵图 URL 等）。 */
export async function getCodexPetDetail(petId: string): Promise<CodexPetSummary> {
  return invoke<CodexPetSummary>('get_codex_pet_detail', { petId })
}

/** 下载某只宠物到本地持久化目录，返回落地信息。 */
export async function downloadCodexPet(petId: string): Promise<LocalPetInfo> {
  return invoke<LocalPetInfo>('download_codex_pet', { petId })
}

/** 列出本地所有已安装的宠物（内置 + 下载）。 */
export async function listLocalPets(): Promise<LocalPetInfo[]> {
  return invoke<LocalPetInfo[]>('list_local_pets')
}

/** 删除本地宠物。 */
export async function deleteLocalPet(petId: string): Promise<void> {
  await invoke('delete_local_pet', { petId })
}

/** 返回某只宠物精灵图的绝对路径。 */
export async function getPetSpritesheetPath(petId: string): Promise<string> {
  return invoke<string>('get_pet_spritesheet_path', { petId })
}

/** 取本地宠物精灵图的可加载 URL（convertFileSrc）。 */
export async function getPetSpritesheetUrl(petId: string): Promise<string> {
  const path = await getPetSpritesheetPath(petId)
  return convertFileSrc(path)
}

/** 把本地绝对路径转成可加载 URL（用于 poster 缩略图）。 */
export function toLocalAssetUrl(absPath: string): string {
  return convertFileSrc(absPath)
}

/** 显示宠物悬浮窗口（自动定位到右下角）。 */
export async function showPetWindow(): Promise<void> {
  await invoke('show_pet_window')
}

/** 隐藏宠物悬浮窗口。 */
export async function hidePetWindow(): Promise<void> {
  await invoke('hide_pet_window')
}

/** 切换宠物悬浮窗口显隐，返回切换后是否可见。 */
export async function togglePetWindow(): Promise<boolean> {
  return invoke<boolean>('toggle_pet_window')
}

/** 设置宠物窗口的始终置顶状态。 */
export async function setPetAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  await invoke('set_pet_always_on_top', { alwaysOnTop })
}

/**
 * 通过 Rust 后端下载远程精灵图到本地缓存，返回可加载的 convertFileSrc URL。
 *
 * 用于宠物市场预览：前端因 CORS 无法直接 fetch codex-pets.net 的精灵图，
 * 通过后端代理下载到本地缓存目录（pets_cache），返回本地文件 URL（带 .webp 扩展名）。
 */
export async function fetchRemoteSpritesheetUrl(petId: string, url: string): Promise<string> {
  const path = await invoke<string>('fetch_remote_spritesheet', { petId, url })
  return convertFileSrc(path)
}

// --- 本地导入 -------------------------------------------------------------

/** 从本地文件导入宠物精灵图（PNG / WebP）。返回落地信息。 */
export async function importLocalPet(
  filePath: string,
  displayName?: string
): Promise<LocalPetInfo> {
  return invoke<LocalPetInfo>('import_local_pet', {
    filePath,
    displayName: displayName ?? null
  })
}

// --- 市场网络代理 ----------------------------------------------------------

/** 读取当前市场代理配置。 */
export async function getMarketProxyConfig(): Promise<ProxyConfig> {
  return invoke<ProxyConfig>('get_market_proxy_config')
}

/** 设置市场代理配置并持久化。 */
export async function setMarketProxy(
  mode: string,
  customUrl: string
): Promise<ProxyConfig> {
  return invoke<ProxyConfig>('set_market_proxy', { mode, customUrl })
}

/** 测试与 codex-pets.net 的网络连通性。 */
export async function testMarketConnection(): Promise<MarketConnectionResult> {
  return invoke<MarketConnectionResult>('test_market_connection')
}
