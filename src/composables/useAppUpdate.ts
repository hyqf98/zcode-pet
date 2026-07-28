/**
 * 应用版本更新检测。
 *
 * 轻量级方案（无需签名密钥）：
 * - 启动后调用 GitHub Releases API（releases/latest）获取最新发布版本。
 * - 将 tag（v1.0.0 → 1.0.0）与当前应用版本（来自 Tauri app.getVersion）做语义化比较。
 * - 远端版本更高时，暴露 latestVersion / downloadUrl 供顶部「下载更新」按钮使用。
 *
 * 仅在 Tauri 运行时（打包后的桌面应用）生效；浏览器开发环境跳过。
 */
import { ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'

/** GitHub 仓库坐标（owner/repo），release workflow 产物回填到这里。 */
const REPO = 'hyqf98/zcode-pet'
const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE_URL = `https://github.com/${REPO}/releases/latest`

export interface AppUpdateInfo {
  /** 是否有可用更新。 */
  hasUpdate: boolean
  /** 最新版本号（已去掉 v 前缀，如 "1.2.0"）。 */
  latestVersion: string
  /** 下载页地址（Release 页）。 */
  downloadUrl: string
  /** 当前应用版本。 */
  currentVersion: string
}

const NO_UPDATE: AppUpdateInfo = {
  hasUpdate: false,
  latestVersion: '',
  downloadUrl: RELEASES_PAGE_URL,
  currentVersion: ''
}

const updateInfo = ref<AppUpdateInfo>({ ...NO_UPDATE })
const checking = ref(false)

/** 把 "v1.2.3" / "1.2.3" / "refs/tags/v1.2.3" 统一解析为 "1.2.3"。 */
function normalizeVersion(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/^refs\/tags\//i, '')
    .replace(/^[vV]/, '')
    .trim()
}

/** 将 "1.2.3" 解析为 [major, minor, patch]，非法返回 null。 */
function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 语义化版本比较：a > b → 1，a < b → -1，相等 → 0。无法解析时返回 0。 */
function compareSemver(a: string, b: string): number {
  const va = parseSemver(a)
  const vb = parseSemver(b)
  if (!va || !vb) return 0
  for (let i = 0; i < 3; i++) {
    if (va[i] > vb[i]) return 1
    if (va[i] < vb[i]) return -1
  }
  return 0
}

/** 获取当前应用版本（Tauri 运行时）。 */
async function fetchCurrentVersion(): Promise<string> {
  if (!isTauri()) return ''
  try {
    return await getVersion()
  } catch {
    return ''
  }
}

/** 请求 GitHub 最新 Release 的 tag_name（带 5 秒超时，失败静默）。 */
async function fetchLatestTag(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(RELEASES_LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json() as { tag_name?: string }
    return normalizeVersion(data.tag_name)
  } catch {
    // 网络错误/超时/非 Tauri 环境都不算「有更新」。
    return null
  }
}

/**
 * 检查更新（静默，失败不抛错）。
 *
 * @returns 检测到的更新信息；无更新或不支持时返回 hasUpdate=false。
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo> {
  if (!isTauri()) {
    updateInfo.value = { ...NO_UPDATE }
    return updateInfo.value
  }

  checking.value = true
  try {
    const [currentVersion, latestTag] = await Promise.all([
      fetchCurrentVersion(),
      fetchLatestTag()
    ])

    if (!currentVersion || !latestTag) {
      updateInfo.value = { ...NO_UPDATE, currentVersion }
      return updateInfo.value
    }

    const hasUpdate = compareSemver(latestTag, currentVersion) > 0
    updateInfo.value = {
      hasUpdate,
      latestVersion: latestTag,
      downloadUrl: RELEASES_PAGE_URL,
      currentVersion
    }
    return updateInfo.value
  } finally {
    checking.value = false
  }
}

/** 版本更新检测 composable。 */
export function useAppUpdate() {
  return {
    updateInfo,
    checking,
    checkForAppUpdate
  }
}
