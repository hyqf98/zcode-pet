/**
 * 宠物设置 store（轻量版，替代原 settings store 里的 4 个桌面宠物键）。
 *
 * 用 localStorage 持久化，不依赖后端数据库。包含：
 *   - enabled：是否启用桌面宠物（独立应用里默认 true，因为这是核心功能）
 *   - activeId：当前激活的宠物 id
 *   - alwaysOnTop：悬浮窗是否始终置顶
 *   - scale：宠物缩放百分比（预留）
 *   - locale：界面语言（'zh-CN' | 'en-US'），驱动 vue-i18n 的 i18n.global.locale；
 *     运行时切换由集成代理在 PetManager 里 watch 该字段实现。
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AppLocale } from '@/locales'

const STORAGE_KEY = 'zcode-pet-settings'

interface PetSettingsData {
  enabled: boolean
  activeId: string | null
  alwaysOnTop: boolean
  scale: number
  locale: AppLocale
}

const DEFAULT_SETTINGS: PetSettingsData = {
  enabled: false,
  activeId: null,
  alwaysOnTop: true,
  scale: 75,
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
  const locale = ref<AppLocale>(stored.locale)

  /** 持久化到 localStorage。 */
  function persist(): void {
    const data: PetSettingsData = {
      enabled: enabled.value,
      activeId: activeId.value,
      alwaysOnTop: alwaysOnTop.value,
      scale: scale.value,
      locale: locale.value
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('[petSettings] persist failed:', e)
    }
  }

  /** 是否已选择过宠物（用于判断首次启动）。 */
  const hasSelectedPet = (): boolean => activeId.value !== null

  // 任意字段变化自动持久化。
  watch([enabled, activeId, alwaysOnTop, scale, locale], persist)

  return {
    enabled,
    activeId,
    alwaysOnTop,
    scale,
    locale,
    hasSelectedPet,
    persist
  }
})
