/**
 * 窗口管理 store（极简版）。
 *
 * 原项目混合了 main/project/mini-panel/pet 四种窗口类型。
 * 独立宠物应用只有两种窗口：
 *   - main：管理窗口（宠物选择/市场/设置）
 *   - pet：悬浮宠物窗口（透明/置顶）
 *
 * 通过 Tauri 的窗口 label 判断当前窗口类型。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

export type WindowType = 'main' | 'pet'

export const useWindowManagerStore = defineStore('windowManager', () => {
  const windowType = ref<WindowType>('main')
  const initialized = ref(false)

  /** 初始化：根据当前窗口 label 判断类型。 */
  function initWindowContext(): void {
    try {
      const label = getCurrentWindow().label
      windowType.value = label === 'pet' ? 'pet' : 'main'
    } catch {
      windowType.value = 'main'
    }
    initialized.value = true
  }

  const isPetWindow = computed(() => windowType.value === 'pet')
  const isMainWindow = computed(() => windowType.value === 'main')

  return {
    windowType,
    initialized,
    initWindowContext,
    isPetWindow,
    isMainWindow
  }
})
