/**
 * 宠物设置 store（轻量版，替代原 settings store 里的 4 个桌面宠物键）。
 *
 * 用 localStorage 持久化，不依赖后端数据库。包含：
 *   - enabled：是否启用桌面宠物（独立应用里默认 true，因为这是核心功能）
 *   - activeId：当前激活的宠物 id
 *   - alwaysOnTop：悬浮窗是否始终置顶
 *   - scale：宠物缩放百分比（预留）
 *   - movementMode：漫游模式（'free' 自由漫游 / 'fixed' 固定位置不走步）
 *   - locale：界面语言（'zh-CN' | 'en-US'），驱动 vue-i18n 的 i18n.global.locale；
 *     运行时切换由集成代理在 PetManager 里 watch 该字段实现。
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AppLocale } from '@/locales'

const STORAGE_KEY = 'zcode-pet-settings'

/** 漫游模式：'free' 自由走步 / 'fixed' 固定位置。 */
export type MovementMode = 'free' | 'fixed'

interface PetSettingsData {
  enabled: boolean
  activeId: string | null
  alwaysOnTop: boolean
  scale: number
  movementMode: MovementMode
  locale: AppLocale
}

const DEFAULT_SETTINGS: PetSettingsData = {
  enabled: false,
  activeId: null,
  alwaysOnTop: true,
  scale: 75,
  movementMode: 'free',
  locale: 'zh-CN'
}

/** 从 localStorage 读取设置（容错：格式错误则用默认值）。 */
function loadFromStorage(): PetSettingsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<PetSettingsData>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const usePetSettingsStore = defineStore('petSettings', () => {
  const stored = loadFromStorage()

  const enabled = ref(stored.enabled)
  const activeId = ref(stored.activeId)
  const alwaysOnTop = ref(stored.alwaysOnTop)
  const scale = ref(stored.scale)
  const movementMode = ref<MovementMode>(stored.movementMode)
  const locale = ref<AppLocale>(stored.locale)

  /**
   * 跨窗口同步标志：persist 写入 localStorage 时置 true，storage 事件处理函数
   * 据此跳过自身写入触发的回环（避免「写→事件→再处理」的冗余）。
   */
  let writing = false

  /** 持久化到 localStorage。 */
  function persist(): void {
    const data: PetSettingsData = {
      enabled: enabled.value,
      activeId: activeId.value,
      alwaysOnTop: alwaysOnTop.value,
      scale: scale.value,
      movementMode: movementMode.value,
      locale: locale.value
    }
    try {
      writing = true
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('[petSettings] persist failed:', e)
    } finally {
      writing = false
    }
  }

  /**
   * 监听 storage 事件：其他窗口（管理窗口）改了设置时，同步到本窗口的 ref。
   *
   * Tauri 多窗口各自独立 JS 上下文，Pinia store 不共享。storage 事件是唯一的
   * 跨窗口通知机制（同源 + localStorage）。writing 标志防止自身 persist 触发的
   * 回环。
   */
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY || writing) return
      const data = loadFromStorage()
      enabled.value = data.enabled
      activeId.value = data.activeId
      alwaysOnTop.value = data.alwaysOnTop
      scale.value = data.scale
      movementMode.value = data.movementMode
      locale.value = data.locale
    })
  }

  /** 是否已选择过宠物（用于判断首次启动）。 */
  const hasSelectedPet = (): boolean => activeId.value !== null

  // 任意字段变化自动持久化。
  watch([enabled, activeId, alwaysOnTop, scale, movementMode, locale], persist)

  return {
    enabled,
    activeId,
    alwaysOnTop,
    scale,
    movementMode,
    locale,
    hasSelectedPet,
    persist
  }
})
