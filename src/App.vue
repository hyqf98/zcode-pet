<script setup lang="ts">
/**
 * App 根组件：根据窗口类型（main / pet）挂载 Naive UI 主题 + 路由。
 *
 * main 窗口：宠物管理面板，负责首次启动选择流 + 监听 pet 窗口"打开设置"事件。
 * pet 窗口：透明悬浮窗，加载 PetView 路由（不由 App.vue 控制，由路由 /pet 决定）。
 */
import { onMounted, onUnmounted, computed } from 'vue'
import { type GlobalTheme } from 'naive-ui'
import { useWindowManagerStore } from '@/stores/windowManager'
import { usePetSettingsStore } from '@/stores/petSettings'
import { useDesktopPetStore } from '@/stores/desktopPet'

const windowManagerStore = useWindowManagerStore()
const petSettings = usePetSettingsStore()
const desktopPetStore = useDesktopPetStore()

// 初始化窗口上下文（判断当前是 main 还是 pet 窗口）。
windowManagerStore.initWindowContext()

// 浅色主题（管理窗口用）。pet 窗口透明，主题无影响。
const theme = computed<GlobalTheme | null>(() => null)

let unlistenOpenSettings: (() => void) | null = null

onMounted(async () => {
  if (windowManagerStore.isMainWindow) {
    // 主窗口：确保本地宠物已加载。
    await desktopPetStore.loadLocalPets()

    // 首次启动（已有选择）：直接显示宠物悬浮窗。
    if (petSettings.hasSelectedPet() && petSettings.enabled) {
      await desktopPetStore.showPet()
    }
    // 未选择：用户在管理窗口里选好后会触发 showPet。

    // 监听 pet 窗口"打开设置"事件 → 主窗口聚焦。
    const { listen } = await import('@tauri-apps/api/event')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    unlistenOpenSettings = await listen('desktop-pet:open-settings', async () => {
      const win = getCurrentWindow()
      try {
        await win.show()
        await win.setFocus()
      } catch (e) {
        console.error('[App] focus main window failed:', e)
      }
    })
  }
})

onUnmounted(() => {
  unlistenOpenSettings?.()
})
</script>

<template>
  <!-- pet 窗口：透明悬浮窗，不包 Naive UI provider（它们会注入不透明背景），直接裸渲染 -->
  <router-view v-if="windowManagerStore.isPetWindow" />

  <!-- main 窗口：管理面板，需要完整的 Naive UI 主题 + 消息 + 对话框 provider -->
  <n-config-provider
    v-else
    :theme="theme"
  >
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
