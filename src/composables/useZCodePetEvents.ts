/**
 * useZCodePetEvents — ZCode 事件 → 宠物动画 + 气泡的全链路驱动器。
 *
 * 职责：
 *   1. 监听后端 `zcode-pet:event` 事件（{@link ZCodePetEventPayload}）。
 *   2. 经 {@link mapEvent} 映射为 {@link NotificationSpec}，入 {@link createNotificationQueue} 队列。
 *   3. 用 `requestAnimationFrame` ticker 每帧推进队列状态机（防抖 + error 抢断）。
 *   4. 队列产出（新）spec 时：用 i18n 渲染文案 → 驱动宠物动画 + ChatBubble
 *      （打字机逐字 / error 即时全文）→ 展示总时长后淡出隐藏。
 *
 * 与 usePetView 的协作：
 *   - 暴露 `isActive`：真实通知进行中时为 true，usePetView 据此让位「模拟 SSE 闲聊」
 *     （真实通知优先于 canned 闲聊，避免争抢同一只 ChatBubble）。
 *
 * 设计说明：
 *   - 时间统一用 `performance.now()`（ms），与队列 `push(spec, now)` / `tick(now)` 一致。
 *   - spec「切换」检测用引用相等（`spec !== displayedSpec`）：队列 `tick` 在无切换时
 *     每帧返回同一 current 引用，故不会误触发重打字机；切换（pending 提升 / error 抢断）
 *     时返回新 spec 引用，触发重打字机。
 *   - PetApp 未暴露 `setText`，故 error（instant）即时分支用 `showChat` + `appendChatToken(整段)`
 *     + `endChat` 三步模拟「立即出全文」。
 *   - 打字机按 Unicode 码点切片（`[...text]`），中文 / emoji 友好，不会把代理对截断。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'
import { mapEvent, createNotificationQueue } from '@/modules/desktopPet/notifications'
import type { NotificationSpec } from '@/modules/desktopPet/notifications'
import { resolveAction } from '@/modules/desktopPet/engine/actionResolver'
import { pickTokenCommentary } from '@/modules/desktopPet/tokenCommentary'
import type { PetApp } from '@/modules/desktopPet/engine'
import type { ZCodePetEventPayload } from '@/types/zcodeHook'
import type { TokenStats } from '@/types/tokenStats'
import { usePetSettingsStore } from '@/stores/petSettings'

/** 单条气泡展示总时长（打字机 + 停留），到点后淡出隐藏并清空队列。 */
const DISPLAY_TOTAL_MS = 4200
/** 打字机逐 token 间隔（ms）。 */
const TYPEWRITER_INTERVAL_MS = 55
/** 每字符额外停留时长（ms），长文本据此延长展示时间。 */
const DISPLAY_MS_PER_CHAR = 70
/** 展示总时长上限（ms），避免超长文本气泡停留过久。 */
const DISPLAY_TOTAL_MAX_MS = 16000

/**
 * 格式化 token 数为简短可读形式（适合气泡展示）。
 *
 * < 1万 → 原始数字千分位；1万~1亿 → "X.X万"；≥1亿 → "X.X亿"。
 */
function formatTokens(n: number): string {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '亿'
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '万'
  return n.toLocaleString()
}

/**
 * 异步追加今日 token 用量统计行到气泡尾部（Stop 事件专用）。
 *
 * 查询失败时静默忽略——token 统计是非关键增强功能。
 */
async function appendTokenLine(app: PetApp, t: ReturnType<typeof useI18n>['t']): Promise<void> {
  try {
    const stats = await invoke<TokenStats | null>('get_zcode_token_stats')
    if (stats && stats.todayTotalTokens > 0) {
      const base = `\n📊 ${t('ui.stats.today')}: ${formatTokens(stats.todayTotalTokens)} · ${stats.todayCalls}${t('ui.stats.calls')}`
      // 按用量档位挑一句调皮调侃拼到统计行后面。
      const comment = pickTokenCommentary(stats.todayTotalTokens, stats.todayCalls)
      app.appendChatToken(`${base}  ${comment}`)
    }
  } catch {
    // token 统计非关键，静默忽略
  }
  app.endChat()
}

/**
 * 监听 ZCode 事件并驱动宠物动画 + 对话气泡。
 *
 * @param petAppRef 宠物应用引用（由 usePetView 持有，可能为 null —— 引擎未就绪时静默跳过）。
 * @returns `isActive`：是否有真实通知正在进行（供 usePetView 互斥判断）。
 */
export function useZCodePetEvents(petAppRef: Ref<PetApp | null>) {
  const { t } = useI18n()
  const petSettings = usePetSettingsStore()
  const queue = createNotificationQueue()
  /** 活动标志：真实通知进行中为 true，usePetView 的模拟聊天应让位。 */
  const isActive = ref(false)

  // --- 当前展示状态（闭包持有，非响应式，避免多余渲染）-------------------
  let displayedSpec: NotificationSpec | null = null
  let typewriterTimer: ReturnType<typeof setInterval> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let rafId: number | null = null
  let unlistenFn: (() => void) | null = null

  /** 清理打字机与隐藏定时器（不触碰 raf / unlisten）。 */
  function clearTimers(): void {
    if (typewriterTimer !== null) {
      clearInterval(typewriterTimer)
      typewriterTimer = null
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  /**
   * 开始展示一条通知：渲染文案 → 切动画 → 打字机 / 即时 → 排定淡出。
   *
   * 引擎未就绪（petApp 为 null）时直接返回，不更新 displayedSpec —— 这样 ticker 下一帧
   * 仍会判定「需展示」并重试，直到引擎就绪后真正渲染。
   */
  function startTyping(spec: NotificationSpec): void {
    const app = petAppRef.value
    if (!app) return

    clearTimers()

    // fullText 优先（Stop 事件的 AI 最终响应正文），否则走 i18n key。
    const text = spec.fullText ?? t(spec.messageKey, spec.params ?? {})

    if (spec.instant) {
      // 即时（error）：不走打字机，立即出全文。
      // PetApp 未暴露 setText，故用 showChat + appendChatToken(整段) + endChat 三步模拟。
      app.showChat()
      app.appendChatToken(text)
      app.endChat()
    } else {
      // 打字机：按 Unicode 码点逐个追加（中文 / emoji 友好）。
      app.showChat()
      const chars = [...text]
      let i = 0
      typewriterTimer = setInterval(() => {
        if (i >= chars.length) {
          if (typewriterTimer !== null) {
            clearInterval(typewriterTimer)
            typewriterTimer = null
          }
          // Stop 事件：打字机结束后异步追加今日 token 用量行（非关键，失败静默）。
          if (spec.appendTokenStats) {
            void appendTokenLine(app, t)
          } else {
            app.endChat()
          }
          return
        }
        app.appendChatToken(chars[i])
        i += 1
      }, TYPEWRITER_INTERVAL_MS)
    }

    // 触发对应动画行（固定模式下 running → idle，避免原地跑不协调）。
    app.playAction(resolveAction(spec.action, petSettings.movementMode))
    displayedSpec = spec

    // 展示总时长按文本长度动态计算：基础时长 + 每字符额外停留，
    // 保证打字机能跑完且读完后有合理停留。Stop（长文本）会获得更长展示时间。
    const charCount = [...text].length
    const dynamicTotal = Math.min(
      DISPLAY_TOTAL_MAX_MS,
      Math.max(DISPLAY_TOTAL_MS, DISPLAY_TOTAL_MS + charCount * DISPLAY_MS_PER_CHAR)
    )
    hideTimer = setTimeout(() => {
      petAppRef.value?.hideChat()
      queue.clear()
      displayedSpec = null
      isActive.value = false
    }, dynamicTotal)
  }

  /**
   * ticker：每帧推进队列状态机；当队列产出新 spec（引用变化）时重新触发打字机 + 动画。
   */
  function onTick(): void {
    const now = performance.now()
    const spec = queue.tick(now)
    if (spec && spec !== displayedSpec) {
      isActive.value = true
      startTyping(spec)
    }
    rafId = requestAnimationFrame(onTick)
  }

  onMounted(async () => {
    unlistenFn = await listen<ZCodePetEventPayload>('zcode-pet:event', (e) => {
      const spec = mapEvent(e.payload)
      if (!spec) return
      isActive.value = true
      queue.push(spec, performance.now())
    })
    rafId = requestAnimationFrame(onTick)
  })

  onUnmounted(() => {
    unlistenFn?.()
    unlistenFn = null
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    clearTimers()
    queue.clear()
    displayedSpec = null
    isActive.value = false
  })

  return { isActive }
}
