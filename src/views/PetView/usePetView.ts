/**
 * usePetView — 桌面宠物悬浮窗视图的 composable。
 *
 * 相比原 easy_agent_pilot 版本：
 *   - settingsStore → petSettingsStore（轻量 localStorage 持久化）
 *   - "打开设置"改为 emit 事件 + 聚焦管理窗口（不再依赖 ui store）
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { usePetSettingsStore } from '@/stores/petSettings'
import { useDesktopPetStore } from '@/stores/desktopPet'
import { useWindowManagerStore } from '@/stores/windowManager'
import { getPetSpritesheetUrl, listLocalPets, setPetAlwaysOnTop } from '@/services/desktopPet'
import { createPetApp, PET_ACTIONS } from '@/modules/desktopPet/engine'
import type { PetApp } from '@/modules/desktopPet/engine'
import type { LocalPetInfo } from '@/types/desktopPet'
import { chunkMessage, pickTimeBasedMessage } from '@/modules/desktopPet/chatSim'
import { useZCodePetEvents } from '@/composables/useZCodePetEvents'

/**
 * 桌面宠物悬浮窗视图 composable。
 *
 * 职责：在透明窗口中 bootstrap Pixi 引擎；加载激活宠物的精灵图；监听切换事件实时换宠物；
 * 画布拖拽移动窗口（OS 级）；左键单击宠物弹出动作菜单（定位在宠物右侧，靠边时自动翻转）；
 * 右键打开自定义菜单（切换下一只 / 动作 / 打开管理 / 隐藏）；鼠标悬停宠物时触发模拟 SSE 对话气泡。
 *
 * 透明窗口默认 setIgnoreCursorEvents(true) 整窗穿透（不阻挡背后软件点击），仅当光标在宠物
 * 精灵包围盒内时切换为可交互，由 click-through 轮询（~60ms）驱动。
 */

// 点击 vs 拖拽阈值（CSS px）。按下后位移超过该值即判定为拖拽，不再视为单击。
const DRAG_THRESHOLD_PX = 5
// click-through 轮询间隔（ms）。穿透态下窗口收不到 pointermove，故用轮询检测光标位置。
const CLICKTHROUGH_POLL_MS = 60
// 模拟 SSE 节奏（ms/token）。
const SIM_TOKEN_INTERVAL_MS = 70
// 移出宠物后对话气泡停留时间再淡出（ms）。
const SIM_LINGER_MS = 600

// 菜单位置估算（与 CSS min-width 对齐）。
const MENU_WIDTH = 140
const MENU_GAP = 12

// --- 长 idle 瞌睡 --------------------------------------------------------
// 超过该时长无交互（无悬停 / 点击 / 真实通知）即进入「瞌睡」。
const SLEEP_IDLE_MS = 90_000
// 瞌睡期间每隔该时长重播一次 waiting 动画，制造呼吸感。
const SLEEP_ANIM_INTERVAL_MS = 10_000
// 瞌睡状态轮询间隔。
const IDLE_CHECK_INTERVAL_MS = 5_000

export function usePetView() {
  const petSettings = usePetSettingsStore()
  const desktopPetStore = useDesktopPetStore()
  const windowManagerStore = useWindowManagerStore()
  // useI18n：宠物窗口自身的 locale 与其 petSettings.locale（启动时从 localStorage 读取）保持一致。
  // 多窗口（管理 / 宠物）各自独立 JS 上下文，跨窗口运行时同步需 storage 事件，超出本任务范围。
  const { locale: i18nLocale } = useI18n()

  const hostRef = ref<HTMLElement | null>(null)
  const petApp = ref<PetApp | null>(null)
  const loadError = ref<string | null>(null)
  const isLoading = ref(true)

  // ZCode 事件驱动器：监听后端事件 → 通知队列 → 宠物动画 + 气泡。
  // 真实通知进行中时 isActive 为 true，模拟 SSE 闲聊应让位。
  const zcodeEvents = useZCodePetEvents(petApp)

  // --- 长 idle 瞌睡状态 --------------------------------------------------
  let lastInteractionAt = Date.now()
  let isSleeping = false
  let lastSleepAnimAt = 0
  let idleChecker: ReturnType<typeof setInterval> | null = null

  // 本地宠物快照（用于"切换下一只"菜单），激活 id 来自 petSettings。
  const localPets = ref<LocalPetInfo[]>([])

  // 右键菜单
  const contextMenuVisible = ref(false)
  const contextMenuX = ref(0)
  const contextMenuY = ref(0)

  // 动作菜单（单击宠物打开）
  const actionMenuVisible = ref(false)
  const actionMenuX = ref(0)
  const actionMenuY = ref(0)

  const actions = PET_ACTIONS

  const activePetId = computed(() => petSettings.activeId)

  // --- 点击 / 拖拽状态机 ------------------------------------------------
  const pointerArmed = ref(false)
  const dragging = ref(false)
  let downX = 0
  let downY = 0
  // 拖拽抓取偏移：按下时光标相对宠物脚位的偏移（CSS px）。拖动时新脚位 = 光标 - 偏移，
  // 使宠物像被「捏住该点」拖动，而非跳到光标位置。窗口内精灵拖拽（不移动覆盖层窗口）。
  let grabOffsetX = 0
  let grabOffsetY = 0

  // --- click-through 状态 ----------------------------------------------
  const win = getCurrentWindow()
  let clickThroughTimer: ReturnType<typeof setInterval> | null = null
  let currentIgnoreState: boolean | null = null
  let hovering = false

  // --- 模拟 SSE 状态 ----------------------------------------------------
  let chatTimer: ReturnType<typeof setInterval> | null = null
  let chatLingerTimer: ReturnType<typeof setTimeout> | null = null

  /** 解析当前激活宠物的精灵图 URL。 */
  async function resolveActiveSrc(): Promise<{ id: string; src: string } | null> {
    const id = activePetId.value
    if (!id) return null
    try {
      const src = await getPetSpritesheetUrl(id)
      return { id, src }
    } catch (error) {
      console.error('[PetView] resolve active spritesheet failed:', error)
      return null
    }
  }

  /** bootstrap 引擎并加载初始宠物。 */
  async function bootPetApp(): Promise<void> {
    if (!hostRef.value) return
    isLoading.value = true
    loadError.value = null

    const resolved = await resolveActiveSrc()
    if (!resolved) {
      // 没有激活宠物：尝试加载本地列表并选第一只。
      localPets.value = await listLocalPets()
      if (localPets.value.length === 0) {
        loadError.value = 'NO_PET_INSTALLED'
        isLoading.value = false
        return
      }
      petSettings.activeId = localPets.value[0].id
    }

    const again = await resolveActiveSrc()
    if (!again) {
      loadError.value = 'NO_PET_INSTALLED'
      isLoading.value = false
      return
    }

    try {
      petApp.value = await createPetApp(hostRef.value, {
        initialPetId: again.id,
        initialSpritesheetSrc: again.src,
        config: { scale: petSettings.scale / 100 }
      })

      // 鼠标进入宠物 → 触发模拟对话；离开宠物 → 停止流式并淡出隐藏。
      petApp.value.onPetHoverChange = handleHoverChange
      isLoading.value = false
    } catch (error) {
      console.error('[PetView] boot pet app failed:', error)
      loadError.value = error instanceof Error ? error.message : String(error)
      isLoading.value = false
    }
  }

  /**
   * 缩放变化时重建 PetApp（PetApp 未暴露 live setScale，故 destroy + 重建）。
   * 保留当前宠物 id 与位置无关的状态，期间 isLoading 短暂为 true。
   */
  async function rebuildPetAppForScale(): Promise<void> {
    if (!hostRef.value) return
    const prevApp = petApp.value
    const petId = prevApp?.currentPetId ?? activePetId.value
    if (!petId) return

    let src: string
    try {
      src = await getPetSpritesheetUrl(petId)
    } catch (error) {
      console.error('[PetView] resolve src for scale rebuild failed:', error)
      return
    }

    isLoading.value = true
    if (prevApp) {
      prevApp.onPetHoverChange = undefined
      petApp.value = null
      await prevApp.destroy()
    }

    try {
      const app = await createPetApp(hostRef.value, {
        initialPetId: petId,
        initialSpritesheetSrc: src,
        config: { scale: petSettings.scale / 100 }
      })
      app.onPetHoverChange = handleHoverChange
      petApp.value = app
    } catch (error) {
      console.error('[PetView] rebuild pet app (scale) failed:', error)
      loadError.value = error instanceof Error ? error.message : String(error)
    } finally {
      isLoading.value = false
    }
  }

  /** 切换到指定宠物 id（运行时换精灵图）。 */
  async function switchToPet(petId: string): Promise<void> {
    if (!petApp.value || petId === petApp.value.currentPetId) return
    petSettings.activeId = petId
    try {
      const src = await getPetSpritesheetUrl(petId)
      await petApp.value.switchPet(petId, src)
    } catch (error) {
      console.error('[PetView] switch pet failed:', error)
    }
  }

  /** 切换到下一只本地宠物（右键菜单"下一只"）。 */
  async function switchToNextPet(): Promise<void> {
    if (localPets.value.length === 0) {
      localPets.value = await listLocalPets()
    }
    if (localPets.value.length === 0) return
    const currentId = activePetId.value ?? localPets.value[0].id
    const currentIndex = localPets.value.findIndex((pet) => pet.id === currentId)
    const nextIndex = (currentIndex + 1) % localPets.value.length
    const next = localPets.value[nextIndex]
    if (next) {
      await switchToPet(next.id)
    }
  }

  // --- 菜单 --------------------------------------------------------------

  /**
   * 计算菜单位置：默认在宠物右侧，右侧放不下则翻到左侧，两侧都不够则居中钳制。
   * 垂直对齐宠物顶部，钳制在窗口可见区内。
   */
  function computeMenuPosition(
    petBounds: { minX: number; minY: number; maxX: number; maxY: number },
    winW: number,
    winH: number,
    menuHeight: number
  ): { x: number; y: number } {
    const rightX = petBounds.maxX + MENU_GAP
    const fitsRight = rightX + MENU_WIDTH <= winW - 8

    let x: number
    if (fitsRight) {
      x = rightX
    } else {
      const leftX = petBounds.minX - MENU_GAP - MENU_WIDTH
      if (leftX >= 8) {
        x = leftX
      } else {
        x = Math.max(8, Math.min(winW - MENU_WIDTH - 8, (winW - MENU_WIDTH) / 2))
      }
    }

    const y = Math.max(8, Math.min(winH - menuHeight - 8, petBounds.minY))
    return { x, y }
  }

  function openActionMenu(): void {
    const app = petApp.value
    if (!app) return
    const bounds = app.getPetBounds()
    const pos = computeMenuPosition(bounds, window.innerWidth, window.innerHeight, 190)
    actionMenuX.value = pos.x
    actionMenuY.value = pos.y
    actionMenuVisible.value = true
    contextMenuVisible.value = false
    void setIgnoreCursorEvents(false)
  }

  function openContextMenu(): void {
    const app = petApp.value
    if (!app) return
    const bounds = app.getPetBounds()
    const pos = computeMenuPosition(bounds, window.innerWidth, window.innerHeight, 90)
    contextMenuX.value = pos.x
    contextMenuY.value = pos.y
    contextMenuVisible.value = true
    actionMenuVisible.value = false
    void setIgnoreCursorEvents(false)
  }

  function closeAllMenus(): void {
    actionMenuVisible.value = false
    contextMenuVisible.value = false
  }

  /** 执行一个动作（动作菜单点击）。 */
  function handleAction(actionId: string): void {
    petApp.value?.playAction(actionId)
    actionMenuVisible.value = false
  }

  /** 隐藏宠物窗口。 */
  async function handleHide(): Promise<void> {
    closeAllMenus()
    await invoke('hide_pet_window')
  }

  /** 打开管理窗口（聚焦 main 窗口）。 */
  async function handleOpenSettings(): Promise<void> {
    closeAllMenus()
    try {
      const { emit } = await import('@tauri-apps/api/event')
      // 管理窗口监听 desktop-pet:open-settings 事件。
      await emit('desktop-pet:open-settings', {})
    } catch (error) {
      console.error('[PetView] open manager failed:', error)
    }
  }

  // --- 拖拽 / 单击 / 右键 ------------------------------------------------

  function handlePointerDown(event: PointerEvent): void {
    wakeUp()
    if (event.button === 2) {
      event.preventDefault()
      openContextMenu()
      return
    }
    if (event.button === 0) {
      const app = petApp.value
      // 仅当按下点命中宠物精灵时才武装拖拽/点击。跨屏覆盖窗下空白处不响应，
      // 避免误判（窗口整屏可点击区域很大）。
      if (!app || !app.hitTest(event.clientX, event.clientY)) return

      pointerArmed.value = true
      dragging.value = false
      downX = event.clientX
      downY = event.clientY
      // 记录抓取偏移：按下点相对宠物脚位（getPetBounds().maxY 为脚位 y，中心 x 为脚位 x）。
      const b = app.getPetBounds()
      grabOffsetX = event.clientX - (b.minX + b.maxX) * 0.5
      grabOffsetY = event.clientY - b.maxY
      // 拖拽期间需接收 pointermove，立即关闭穿透。
      void setIgnoreCursorEvents(false)
    }
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!pointerArmed.value || dragging.value) return
    if (event.buttons !== 1) return
    const dx = event.clientX - downX
    const dy = event.clientY - downY
    if (Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX) {
      dragging.value = true
    }
    if (dragging.value) {
      // 窗口内精灵拖拽：新脚位 = 光标 - 抓取偏移。dragTo 内部 clamp 进 PetBounds（拖不到屏外/死区）。
      petApp.value?.dragTo(event.clientX - grabOffsetX, event.clientY - grabOffsetY)
    }
  }

  function handleWindowPointerUp(event: PointerEvent): void {
    if (!pointerArmed.value) return
    const wasDragging = dragging.value
    pointerArmed.value = false
    dragging.value = false
    if (wasDragging) return

    const app = petApp.value
    if (!app) return
    const hit = app.hitTest(event.clientX, event.clientY)
    if (hit) {
      openActionMenu()
    } else {
      closeAllMenus()
    }
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    openContextMenu()
  }

  // --- 透明窗口穿透控制 --------------------------------------------------

  /** 设置窗口是否忽略鼠标事件（穿透）。带去重，避免重复 IPC 调用。 */
  async function setIgnoreCursorEvents(ignore: boolean): Promise<void> {
    if (currentIgnoreState === ignore) return
    currentIgnoreState = ignore
    try {
      await win.setIgnoreCursorEvents(ignore)
    } catch (error) {
      console.error('[PetView] setIgnoreCursorEvents failed:', error)
      currentIgnoreState = null
    }
  }

  /**
   * click-through 轮询：每 ~60ms 检测光标是否在宠物包围盒内。
   */
  async function pollClickThrough(): Promise<void> {
    const app = petApp.value
    if (!app) return
    if (pointerArmed.value || dragging.value || actionMenuVisible.value || contextMenuVisible.value) {
      await setIgnoreCursorEvents(false)
      return
    }

    try {
      const [cursor, origin, scale] = await Promise.all([
        import('@tauri-apps/api/window').then((m) => m.cursorPosition()),
        win.outerPosition(),
        win.scaleFactor()
      ])
      if (scale <= 0) return

      const localX = (cursor.x - origin.x) / scale
      const localY = (cursor.y - origin.y) / scale

      const b = app.getPetBounds()
      const inside = localX >= b.minX && localX <= b.maxX && localY >= b.minY && localY <= b.maxY

      await setIgnoreCursorEvents(!inside)
      if (inside !== hovering) {
        hovering = inside
        app.onPetHoverChange?.(inside)
      }
    } catch {
      await setIgnoreCursorEvents(false)
    }
  }

  function startClickThroughLoop(): void {
    if (clickThroughTimer) return
    clickThroughTimer = setInterval(() => {
      void pollClickThrough()
    }, CLICKTHROUGH_POLL_MS)
  }

  function stopClickThroughLoop(): void {
    if (clickThroughTimer) {
      clearInterval(clickThroughTimer)
      clickThroughTimer = null
    }
  }

  // --- 长 idle 瞌睡 -------------------------------------------------------

  /** 唤醒：复位 idle 计时并退出瞌睡态（任意交互 / 真实通知到达时调用）。 */
  function wakeUp(): void {
    if (isSleeping) {
      // 从瞌睡中醒来：播放一次 idle 动作，给一个「睁眼」式的视觉反馈。
      petApp.value?.playAction('idle')
      isSleeping = false
    }
    lastInteractionAt = Date.now()
  }

  /**
   * idle 轮询：长时间无交互（> {@link SLEEP_IDLE_MS}）且无真实通知、未拖拽 / 未开菜单时，
   * 进入「瞌睡」并每隔 {@link SLEEP_ANIM_INTERVAL_MS} 重播一次 waiting 动画制造呼吸感。
   *
   * Zzz 表情注入待后续：EmoteBubble 使用 atlas 纹理而非字体 emoji，不便直接注入 💤；
   * 这里复用 waiting 动画行 + playAction 自带的心形 emote 弹出作为视觉提示。
   */
  function startIdleChecker(): void {
    if (idleChecker) return
    idleChecker = setInterval(() => {
      const app = petApp.value
      if (!app) return
      // 任何「活动」都视作交互，复位 idle 计时。
      if (
        zcodeEvents.isActive.value ||
        pointerArmed.value ||
        dragging.value ||
        actionMenuVisible.value ||
        contextMenuVisible.value
      ) {
        wakeUp()
        return
      }
      const idleMs = Date.now() - lastInteractionAt
      if (idleMs <= SLEEP_IDLE_MS) return
      isSleeping = true
      if (Date.now() - lastSleepAnimAt >= SLEEP_ANIM_INTERVAL_MS) {
        app.playAction('waiting')
        lastSleepAnimAt = Date.now()
      }
    }, IDLE_CHECK_INTERVAL_MS)
  }

  function stopIdleChecker(): void {
    if (idleChecker) {
      clearInterval(idleChecker)
      idleChecker = null
    }
  }

  /**
   * 悬停统一处理：先唤醒（悬停即交互），再分派模拟对话。
   * bootPetApp / rebuildPetAppForScale 都把 onPetHoverChange 指向此函数。
   */
  function handleHoverChange(inside: boolean): void {
    wakeUp()
    if (inside) {
      startSimulatedChat()
    } else {
      stopSimulatedChat()
    }
  }

  // --- 模拟 SSE 对话 -----------------------------------------------------

  /** 鼠标悬停到宠物时启动一段模拟流式对话（打字机）。每次悬停都触发。 */
  function startSimulatedChat(): void {
    // 真实 ZCode 通知优先：进行中时让出 ChatBubble，不打 canned 闲聊。
    if (zcodeEvents.isActive.value) return
    const app = petApp.value
    if (!app) return
    stopChatTimers()
    app.showChat()

    const chunks = chunkMessage(pickTimeBasedMessage())
    let index = 0
    chatTimer = setInterval(() => {
      if (index >= chunks.length) {
        finishStreaming()
        return
      }
      app.appendChatToken(chunks[index])
      index += 1
    }, SIM_TOKEN_INTERVAL_MS)
  }

  /** 鼠标移出宠物：停止流式，短暂停留后淡出隐藏。 */
  function stopSimulatedChat(): void {
    // 真实通知进行中时，ChatBubble 由通知驱动器托管，这里不收尾以免误关。
    if (zcodeEvents.isActive.value) return
    const app = petApp.value
    if (!app) return
    if (chatTimer) {
      clearInterval(chatTimer)
      chatTimer = null
    }
    app.endChat()
    chatLingerTimer = setTimeout(() => {
      petApp.value?.hideChat()
      chatLingerTimer = null
    }, SIM_LINGER_MS)
  }

  function finishStreaming(): void {
    if (chatTimer) {
      clearInterval(chatTimer)
      chatTimer = null
    }
    petApp.value?.endChat()
  }

  function stopChatTimers(): void {
    if (chatTimer) {
      clearInterval(chatTimer)
      chatTimer = null
    }
    if (chatLingerTimer) {
      clearTimeout(chatLingerTimer)
      chatLingerTimer = null
    }
  }

  // --- 生命周期 ----------------------------------------------------------

  onMounted(async () => {
    // 标记 body 为透明窗口，覆盖全局不透明背景，让桌面透出。
    document.body.classList.add('pet-window-transparent')

    // 同步 i18n locale 与 petSettings.locale（启动时按持久化选择渲染文案）。
    i18nLocale.value = petSettings.locale

    // pet 窗口需初始化窗口上下文 + 同步置顶状态。
    windowManagerStore.initWindowContext()
    await setPetAlwaysOnTop(petSettings.alwaysOnTop)

    // 监听管理窗口发出的切换事件。
    await desktopPetStore.startPetSwitchListener((payload) => {
      void switchToPet(payload.petId)
    })

    window.addEventListener('pointermove', handleWindowPointerMove, true)
    window.addEventListener('pointerup', handleWindowPointerUp, true)

    await bootPetApp()

    startClickThroughLoop()
    startIdleChecker()
    lastInteractionAt = Date.now()
  })

  // petSettings.activeId 被外部（管理窗口）改写时，若引擎已就绪则切换。
  watch(activePetId, (id) => {
    if (id && petApp.value && id !== petApp.value.currentPetId) {
      void switchToPet(id)
    }
  })

  // 缩放变化：重建 PetApp（PetApp 无 live setScale）。拖拽 / 加载中时跳过，避免抖动。
  watch(
    () => petSettings.scale,
    () => {
      if (petApp.value && !dragging.value && !isLoading.value) {
        void rebuildPetAppForScale()
      }
    }
  )

  onUnmounted(() => {
    document.body.classList.remove('pet-window-transparent')
    window.removeEventListener('pointermove', handleWindowPointerMove, true)
    window.removeEventListener('pointerup', handleWindowPointerUp, true)
    stopClickThroughLoop()
    stopIdleChecker()
    stopChatTimers()
    desktopPetStore.stopPetSwitchListener()
    void setIgnoreCursorEvents(false)
    void petApp.value?.destroy()
    petApp.value = null
  })

  return {
    hostRef,
    petApp,
    loadError,
    isLoading,
    localPets,
    contextMenuVisible,
    contextMenuX,
    contextMenuY,
    actionMenuVisible,
    actionMenuX,
    actionMenuY,
    actions,
    activePetId,
    handlePointerDown,
    handleContextMenu,
    handleAction,
    switchToNextPet,
    handleHide,
    handleOpenSettings,
    closeAllMenus
  }
}
