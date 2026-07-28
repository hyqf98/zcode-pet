import { describe, expect, it } from 'vitest'

import { createNotificationQueue } from '../notificationQueue'

import type { NotificationSpec, Severity } from '../types'

// 构造最小可用 NotificationSpec 的工厂：用 messageKey 区分不同实例以便引用比较。
function spec(
  severity: Severity,
  messageKey: string,
  overrides: Partial<NotificationSpec> = {}
): NotificationSpec {
  return {
    action: 'running',
    messageKey,
    severity,
    minDisplayMs: 1200,
    ...overrides,
  }
}

describe('createNotificationQueue', () => {
  it('first push becomes current immediately', () => {
    const q = createNotificationQueue()
    const a = spec('info', 'a')

    q.push(a, 0)

    expect(q.current).toBe(a)
    expect(q.isActive).toBe(true)
    expect(q.tick(0)).toBe(a)
  })

  it('keeps the newest non-error in pending and switches after minDisplayMs', () => {
    const q = createNotificationQueue()
    const a = spec('info', 'a')
    const b = spec('info', 'b')

    q.push(a, 0)
    q.push(b, 100)

    // t=100：a 仍是 current，b 进 pending
    expect(q.current).toBe(a)
    expect(q.tick(100)).toBe(a)
    // 未满 minDisplayMs，不切换
    expect(q.tick(1199)).toBe(a)
    // 满 minDisplayMs 后切换到 b
    expect(q.tick(1200)).toBe(b)
    expect(q.current).toBe(b)
  })

  it('error preempts a displaying info immediately (before minDisplayMs)', () => {
    const q = createNotificationQueue()
    const a = spec('info', 'a')
    const err = spec('error', 'err')

    q.push(a, 0)
    // t=500 < 1200，info 仍在展示，error 立即抢断
    q.push(err, 500)

    expect(err.severity).toBe('error')
    expect(q.current).toBe(err)
    expect(q.tick(500)).toBe(err)
  })

  it('error preemption discards any pending entry (no revert to older pending)', () => {
    const q = createNotificationQueue()
    const a = spec('info', 'a')
    const b = spec('info', 'b') // 进 pending
    const err = spec('error', 'err')

    q.push(a, 0)
    q.push(b, 100) // pending = b
    q.push(err, 200) // 抢断 -> current = err，pending 清空

    expect(q.current).toBe(err)
    // err 满 minDisplayMs 后无 pending，继续展示 err（不切回 b）
    expect(q.tick(2000)).toBe(err)
    expect(q.current).toBe(err)
  })

  it('pending only keeps the latest entry', () => {
    const q = createNotificationQueue()
    const base = spec('info', 'base')
    const a = spec('info', 'a')
    const b = spec('info', 'b')
    const c = spec('info', 'c')

    q.push(base, 0) // base 成为 current
    q.push(a, 100)
    q.push(b, 200)
    q.push(c, 300) // pending 被反复覆盖，最终只保留 c

    // 切换后直接展示 c（a、b 被丢弃）
    expect(q.tick(1300)).toBe(c)
    expect(q.current).toBe(c)
  })

  it('does not auto-clear: keeps returning current after switch when pending is empty', () => {
    const q = createNotificationQueue()
    const a = spec('info', 'a')
    const b = spec('info', 'b')

    q.push(a, 0)
    q.push(b, 100)

    expect(q.tick(1200)).toBe(b) // 切换
    expect(q.tick(9999)).toBe(b) // 仍展示 b，未自动清空
    expect(q.current).toBe(b)
    expect(q.isActive).toBe(true)
  })

  it('respects custom minDisplayMs on the displaying spec', () => {
    const q = createNotificationQueue()
    const a = spec('info', 'a', { minDisplayMs: 3000 })
    const b = spec('info', 'b')

    q.push(a, 0)
    q.push(b, 10)

    // 自定义 minDisplayMs=3000：默认阈值 1200 时不应切换
    expect(q.tick(2999)).toBe(a)
    expect(q.tick(3000)).toBe(b)
  })

  it('clear() empties both current and pending', () => {
    const q = createNotificationQueue()

    q.push(spec('info', 'a'), 0)
    q.push(spec('info', 'b'), 100)
    expect(q.isActive).toBe(true)

    q.clear()

    expect(q.current).toBeNull()
    expect(q.isActive).toBe(false)
    expect(q.tick(9999)).toBeNull()
  })
})
