/**
 * 应用版本更新检测与应用内安装。
 *
 * 基于 Tauri 官方 updater 插件：
 * - 启动后调用 check() 向 endpoints（GitHub Release latest.json）查询，
 *   updater 插件会用配置的 pubkey 校验签名。
 * - 远端版本更高时，暴露 hasUpdate / latestVersion 供顶部「下载更新」按钮显示。
 * - 点击按钮调用 downloadAndInstall() 下载并安装，完成后 relaunch 重启。
 *
 * 仅在 Tauri 运行时（打包后的桌面应用）生效；浏览器开发环境静默跳过。
 */
import { ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

/** 下载进度快照（用于进度条展示）。 */
export interface DownloadProgress {
  /** 已下载字节。 */
  downloaded: number
  /** 总字节（可能为 null）。 */
  total: number | null
  /** 百分比 0-100（total 未知时为 null）。 */
  percent: number | null
}

/** 对外暴露的更新信息。 */
export interface AppUpdateInfo {
  /** 是否有可用更新。 */
  hasUpdate: boolean
  /** 最新版本号（已去掉 v 前缀）。 */
  latestVersion: string
  /** 当前应用版本。 */
  currentVersion: string
  /** 发布说明。 */
  notes: string | null
}

const NO_UPDATE: AppUpdateInfo = {
  hasUpdate: false,
  latestVersion: '',
  currentVersion: '',
  notes: null
}

const updateInfo = ref<AppUpdateInfo>({ ...NO_UPDATE })
const checking = ref(false)
/** 下载安装中（按钮 loading）。 */
const installing = ref(false)
/** 下载进度。 */
const progress = ref<DownloadProgress>({ downloaded: 0, total: null, percent: null })

/** 缓存检测到的 Update 句柄，供 downloadAndInstall 使用。 */
let pendingUpdate: Update | null = null

/** 把 "v1.2.3" / "refs/tags/v1.2.3" 统一解析为 "1.2.3"。 */
function normalizeVersion(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/^refs\/tags\//i, '').replace(/^[vV]/, '').trim()
}

/**
 * 检查更新（静默，失败不抛错）。
 *
 * @returns 更新信息；无更新或不支持时返回 hasUpdate=false。
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo> {
  if (!isTauri()) {
    updateInfo.value = { ...NO_UPDATE }
    return updateInfo.value
  }

  checking.value = true
  try {
    const currentVersion = await getVersion().catch(() => '')
    const update = await check({ timeout: 20_000 }).catch(() => null)

    if (!update) {
      pendingUpdate = null
      updateInfo.value = { ...NO_UPDATE, currentVersion }
      return updateInfo.value
    }

    pendingUpdate = update
    const latestVersion = normalizeVersion(update.version)
    updateInfo.value = {
      hasUpdate: true,
      latestVersion,
      currentVersion: update.currentVersion || currentVersion,
      notes: update.body ?? null
    }
    return updateInfo.value
  } finally {
    checking.value = false
  }
}

/**
 * 下载并安装当前可用更新，完成后重启应用。
 *
 * @throws 若无可用更新或安装失败。调用方应 try/catch 并提示。
 */
export async function downloadAndInstallUpdate(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error('no update available')
  }

  installing.value = true
  progress.value = { downloaded: 0, total: null, percent: null }
  try {
    let downloaded = 0
    let total: number | null = null
    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? null
          progress.value = { downloaded: 0, total, percent: total ? 0 : null }
          break
        case 'Progress':
          downloaded += event.data.chunkLength
          progress.value = {
            downloaded,
            total,
            percent: total && total > 0 ? Math.round((downloaded / total) * 100) : null
          }
          break
        case 'Finished':
          progress.value = { downloaded, total, percent: 100 }
          break
      }
    })
    // 安装完成后重启应用（Windows NSIS 为 passive 模式，会自行完成）。
    await relaunch()
  } finally {
    installing.value = false
  }
}

/** 版本更新检测 composable。 */
export function useAppUpdate() {
  return {
    updateInfo,
    checking,
    installing,
    progress,
    checkForAppUpdate,
    downloadAndInstallUpdate
  }
}
