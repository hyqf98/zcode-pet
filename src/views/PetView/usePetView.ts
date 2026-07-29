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
import type { TokenStats } from '@/types/tokenStats'
import { chunkMessage, pickTimeBasedMessage } from '@/modules/desktopPet/chatSim'
import { pickTokenCommentary } from '@/modules/desktopPet/tokenCommentary'
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
// 单击显示 token 用量气泡的停留时长（ms）。
const TOKEN_BUBBLE_LINGER_MS = 5000
// 定时自动展示 token 用量的间隔（ms，每 5 分钟）。
const TOKEN_AUTO_INTERVAL_MS = 5 * 60 * 1000

/** 格式化 token 数为简短可读形式（与 useZCodePetEvents 一致）。 */
function formatTokens(n: number): string {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '亿'
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '万'
  return n.toLocaleString()
}

export function usePetView() {
  const petSettings = usePetSettingsStore()
  const desktopPetStore = useDesktopPetStore()
  const windowManagerStore = useWindowManagerStore()
  // useI18n：宠物窗口自身的 locale 与其 petSettings.locale（启动时从 localStorage 读取）保持一致。
  // 多窗口（管理 / 宠物）各自独立 JS 上下文，跨窗口运行时同步需 storage 事件，超出本任务范围。
  const { t: i18nT, locale: i18nLocale } = useI18n()

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
  // 单击 token 气泡的停留计时器。
  let tokenBubbleTimer: ReturnType<typeof setTimeout> | null = null
  // 定时自动展示 token 用量的轮询计时器。
  let tokenAutoTimer: ReturnType<typeof setInterval> | null = null

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
      // 应用持久化的漫游模式（固定时不走步，只停在原地）。
      petApp.value.setMovementMode(petSettings.movementMode)
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
      // 重建后重新应用漫游模式（与 bootPetApp 保持一致）。
      app.setMovementMode(petSettings.movementMode)
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

  // --- 单击 token 用量气泡 ------------------------------------------------

  /**
   * 单击宠物时显示今日 token 用量气泡。
   *
   * 异步查询 ZCode SQLite 库，成功时在 ChatBubble 显示 "📊 今日 3200万 · 232次调用"；
   * 查询失败或无数据时显示 i18n 提示文案。气泡停留 5s 后自动淡出。
   *
   * 与拖动不冲突：此函数仅在 handleWindowPointerUp 判定为「非拖动单击」后调用，
   * 拖动（wasDragging=true）时不会到达此处。
   *
   * 与模拟 SSE 闲聊互斥：显示前先停止悬停闲聊定时器，避免争抢 ChatBubble。
   */
  async function showTokenUsage(): Promise<void> {
    // 真实 ZCode 通知进行中时不抢占气泡。
    if (zcodeEvents.isActive.value) return
    const app = petApp.value
    if (!app) return

    // 停掉悬停闲聊，避免气泡争抢。
    stopChatTimers()

    let line: string
    try {
      const stats = await invoke<TokenStats | null>('get_zcode_token_stats')
      if (stats && stats.todayTotalTokens > 0) {
        // 统计行 + 按用量档位挑一句调皮调侃。
        const comment = pickTokenCommentary(stats.todayTotalTokens, stats.todayCalls)
        line = `📊 ${i18nT('ui.stats.today')}: ${formatTokens(stats.todayTotalTokens)} · ${stats.todayCalls}${i18nT('ui.stats.calls')}  ${comment}`
      } else {
        // 无数据（ZCode 今天还没用过），显示友好提示。
        line = '📊 ' + i18nT('ui.stats.noData')
      }
    } catch {
      // DB 未检测到或查询失败：静默，不弹气泡。
      return
    }

    // 查询期间气泡可能被其他事件关闭，二次检查。
    if (zcodeEvents.isActive.value) return

    app.showChat()
    // 逐字打字机效果，与整体风格一致。
    const chars = [...line]
    let i = 0
    chatTimer = setInterval(() => {
      if (i >= chars.length) {
        finishStreaming()
        return
      }
      app.appendChatToken(chars[i])
      i += 1
    }, SIM_TOKEN_INTERVAL_MS)

    // 排定淡出。
    if (tokenBubbleTimer) {
      clearTimeout(tokenBubbleTimer)
    }
    tokenBubbleTimer = setTimeout(() => {
      petApp.value?.hideChat()
      tokenBubbleTimer = null
    }, TOKEN_BUBBLE_LINGER_MS)
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

  /** 打开动作菜单（当前不再由左键单击触发，保留供右键菜单或扩展使用）。 */
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

  /**
   * 重置宠物到当前屏中心。
   *
   * 窗口恒为「单屏铺满当前显示器」，故画布中心即屏幕中心。dragTo → brain.setPosition
   * 内部 clamp 进 PetBounds（不会出屏/进死区），并进入 idle，松开后从中心重新决策。
   */
  function handleResetToCenter(): void {
    petApp.value?.dragTo(window.innerWidth / 2, window.innerHeight / 2)
  }

  /**
   * 切换漫游模式：自由 / 固定。
   *
   * 写入 petSettings.movementMode（store 自动持久化），引擎由下面的 watch 同步应用，
   * 故此处只改状态、不直接调引擎（避免重建竞态）。
   */
  function handleToggleMovementMode(): void {
    petSettings.movementMode = petSettings.movementMode === 'fixed' ? 'free' : 'fixed'
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
    // 注意：此处只判 pointerArmed。不可再判 dragging.value ——
    // dragging 一旦置 true 就会让本函数提前 return，导致 dragTo 仅在跨过 5px 阈值那一帧
    // 调用一次、之后整段手势冻结（表现为「拖不动 / 卡住」）。dragging 仅用于区分单击与拖拽。
    if (!pointerArmed.value) return
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
      // 左键单击命中宠物：仅显示今日 token 用量气泡（不再弹动画菜单）。
      // 动画菜单改为仅右键菜单可访问。
      void showTokenUsage()
    } else {
      closeAllMenus()
    }
  }

  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    openContextMenu()
  }

  /**
   * 全局 pointerdown：菜单可见时，点击落在菜单/宠物精灵外则关闭菜单。
   *
   * 菜单打开后窗口整屏可交互（setIgnoreCursorEvents=false），空白区域
   * pointerdown 会到达 JS，借此实现「点击外部关闭」。
   * 命中宠物精灵时不关（让 pointerdown→pointerup 的单击流程接管）。
   */
  function handleGlobalPointerDown(event: PointerEvent): void {
    if (!actionMenuVisible.value && !contextMenuVisible.value) return
    // 命中宠物精灵：不干预，交给单击/拖拽逻辑处理。
    const app = petApp.value
    if (app && app.hitTest(event.clientX, event.clientY)) return
    // 检查是否点在菜单 DOM 内（菜单有 @pointerdown.stop，但保险起见再判断一次）。
    const target = event.target as HTMLElement | null
    if (target?.closest('.pet-menu')) return
    // 点在空白区域：关闭菜单 + 立即恢复穿透态（不等 60ms 轮询）。
    closeAllMenus()
    void pollClickThrough()
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

  // --- 定时 token 用量气泡 -----------------------------------------------

  /**
   * 每 {@link TOKEN_AUTO_INTERVAL_MS} 自动展示一次今日 token 用量。
   *
   * 与手动单击调用同一个 {@link showTokenUsage}，但跳过条件更严格：
   * 真实 ZCode 通知进行中 / 用户正在拖拽 / 正在开菜单 / 悬停闲聊进行中时不打扰。
   */
  function startTokenAutoTimer(): void {
    if (tokenAutoTimer) return
    tokenAutoTimer = setInterval(() => {
      // 真实通知进行中：不打断。
      if (zcodeEvents.isActive.value) return
      // 用户正在交互（拖拽 / 开菜单 / 武装点击）：不打扰。
      if (pointerArmed.value || dragging.value || actionMenuVisible.value || contextMenuVisible.value) return
      void showTokenUsage()
    }, TOKEN_AUTO_INTERVAL_MS)
  }

  function stopTokenAutoTimer(): void {
    if (tokenAutoTimer) {
      clearInterval(tokenAutoTimer)
      tokenAutoTimer = null
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
    if (tokenBubbleTimer) {
      clearTimeout(tokenBubbleTimer)
      tokenBubbleTimer = null
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
    window.addEventListener('pointerdown', handleGlobalPointerDown, true)

    await bootPetApp()

    startClickThroughLoop()
    startIdleChecker()
    startTokenAutoTimer()
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

  // 漫游模式变化（自由 / 固定）：实时应用到引擎，无需重建。
  // 跨窗口经 localStorage 同步（管理窗口设置页改动也会触发），保持两端一致。
  watch(
    () => petSettings.movementMode,
    (mode) => {
      petApp.value?.setMovementMode(mode)
    }
  )

  onUnmounted(() => {
    document.body.classList.remove('pet-window-transparent')
    window.removeEventListener('pointermove', handleWindowPointerMove, true)
    window.removeEventListener('pointerup', handleWindowPointerUp, true)
    window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
    stopClickThroughLoop()
    stopIdleChecker()
    stopTokenAutoTimer()
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
    openActionMenu,
    switchToNextPet,
    handleHide,
    handleOpenSettings,
    handleResetToCenter,
    handleToggleMovementMode,
    closeAllMenus
  }
}
