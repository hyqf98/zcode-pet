/**
 * 通知队列：最新优先 + 防抖 + error 抢断。
 *
 * 纯逻辑、无定时器依赖：由外部 ticker（requestAnimationFrame 等）每帧调用
 * {@link NotificationQueue.tick} 推进状态机。时间以 `now: number`（ms 时间戳）显式传入，
 * 便于测试与确定性运行。
 *
 * 状态机规则：
 * - `current`：正在展示的 spec，记录 `displayStartedAt`。
 * - `pending`：待显示的下一条（最多 1 条，push 覆盖，始终只保留最新一条）。
 *
 * push 行为：
 * - 队列为空：直接成为 current。
 * - 队列非空且新通知为 error：**立即抢断**，成为新 current，并丢弃旧 pending
 *   （error 为最新且最高优先级，抢断后不应再被更旧的 pending 顶回）。
 * - 否则：写入 pending（覆盖已有 pending）。
 *
 * tick 行为：
 * - 当 current 已展示 ≥ minDisplayMs 且 pending 非空：切换到 pending，返回新 current。
 * - 否则：返回当前 current（可能为 null）。tick 不会自动清空——清空由调用方通过
 *   {@link NotificationQueue.clear} 或展示总时长控制。
 */

import type { NotificationSpec } from './types'

/** 默认最短展示时长 ms。调大以避免快速连发事件（PreToolUse→PostToolUse）一闪而过。 */
const DEFAULT_MIN_DISPLAY_MS = 2200

/** 队列内部对一条展示中通知的包装，记录开始展示时刻。 */
interface DisplayEntry {
  spec: NotificationSpec
  displayStartedAt: number
}

/** 通知队列公共契约。 */
export interface NotificationQueue {
  /**
   * 入队一条通知。
   *
   * @param spec 通知规格
   * @param now 当前时间戳 ms（默认 0，生产中由 ticker 传入）
   */
  push(spec: NotificationSpec, now?: number): void

  /**
   * 由外部 ticker 每帧调用，推进状态机。
   *
   * 返回值表示「这一帧应展示的 spec」；切换发生时返回新的 spec，调用方据此重新
   * 触发打字机 / 动画。返回 `null` 表示当前无内容展示。
   *
   * @param now 当前时间戳 ms
   * @returns 本帧应展示的 spec，null 表示无内容展示
   */
  tick(now: number): NotificationSpec | null

  /**
   * 主动清空队列（current 与 pending 一并置空）。
   *
   * 调用方在展示总时长达到后调用此方法收尾。
   */
  clear(): void

  /** 当前正在展示的 spec（只读）。 */
  readonly current: NotificationSpec | null

  /** 是否有通知活动（展示中或待显示）。 */
  readonly isActive: boolean
}

/**
 * 创建一个通知队列实例。
 *
 * 实例内部状态通过闭包持有，对外仅暴露 {@link NotificationQueue} 契约。
 */
export function createNotificationQueue(): NotificationQueue {
  let currentEntry: DisplayEntry | null = null
  let pendingEntry: DisplayEntry | null = null

  return {
    push(spec, now = 0) {
      if (currentEntry === null) {
        currentEntry = { spec, displayStartedAt: now }
        return
      }
      if (spec.severity === 'error') {
        // error 立即抢断：成为新 current，并丢弃旧 pending。
        currentEntry = { spec, displayStartedAt: now }
        pendingEntry = null
        return
      }
      // 非 error：写入 pending，覆盖已有项，始终只保留最新一条。
      pendingEntry = { spec, displayStartedAt: now }
    },

    tick(now) {
      if (currentEntry === null) {
        return null
      }
      const minDisplayMs = currentEntry.spec.minDisplayMs ?? DEFAULT_MIN_DISPLAY_MS
      if (now - currentEntry.displayStartedAt >= minDisplayMs && pendingEntry !== null) {
        currentEntry = pendingEntry
        pendingEntry = null
      }
      return currentEntry.spec
    },

    clear() {
      currentEntry = null
      pendingEntry = null
    },

    get current() {
      return currentEntry === null ? null : currentEntry.spec
    },

    get isActive() {
      return currentEntry !== null || pendingEntry !== null
    },
  }
}
