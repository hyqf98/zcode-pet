import { describe, expect, it } from 'vitest'

import { PetBrain } from '../PetBrain'
import { clampPointToBounds, clampToPetBounds, pickRandomTarget } from '../math'

import type { Bounds, PetConfig } from '../types'
import type { PetBounds } from '../viewport'

// 这些测试覆盖从 pixi-pet-demo 移植的纯漫游逻辑（PetBrain 状态机 + math 工具），
// 以及多屏「死区吸附」边界（PetBounds）。它们不依赖 Pixi / DOM / Tauri，因此可纯 node 环境运行。

const bounds: Bounds = {
  minX: 40,
  minY: 64,
  maxX: 360,
  maxY: 260
}

/** 把单个 Bounds 包成单矩形 PetBounds（模拟单屏 / preview 模式）。 */
function singleRectPetBounds(b: Bounds): PetBounds {
  return { aabb: b, monitors: [b] }
}

/** 构造双屏 PetBounds：两块并排显示器，中间无死区。 */
function dualMonitorPetBounds(): PetBounds {
  const left: Bounds = { minX: 40, minY: 64, maxX: 360, maxY: 260 }
  const right: Bounds = { minX: 400, minY: 64, maxX: 720, maxY: 260 }
  return {
    aabb: { minX: 40, minY: 64, maxX: 720, maxY: 260 },
    monitors: [left, right]
  }
}

/**
 * 构造「带死区」的双屏 PetBounds：两块高度不同的显示器并排，
 * 主屏底部之外的区域是死区（无任何显示器覆盖）。
 *
 *   主屏 (40,64)-(360,260)
 *                 ┌────────┐  副屏 (400,64)-(720,180)
 *                 │        │  ┌────────┐
 *   主屏          │  死区  │  │  副屏  │
 *   ┌────────┐    │        │  └────────┘
 *   │        │    │        │  (副屏下方 y>180 为并集内但无屏)
 *   └────────┘    └────────┘
 *                 (主屏右侧 x∈(360,400) 为并集内但无屏)
 */
function deadZonePetBounds(): PetBounds {
  const left: Bounds = { minX: 40, minY: 64, maxX: 360, maxY: 260 }
  const right: Bounds = { minX: 400, minY: 64, maxX: 720, maxY: 180 }
  return {
    aabb: { minX: 40, minY: 64, maxX: 720, maxY: 260 },
    monitors: [left, right]
  }
}

const config: PetConfig = {
  scale: 4,
  walkSpeed: 120,
  idleDurationRange: [100, 100],
  reactionDuration: 180,
  particleCount: 12
}

describe('PetBrain', () => {
  it('transitions idle -> walk -> react -> idle', () => {
    const brain = new PetBrain(config, singleRectPetBounds(bounds), sequenceRng([0.95, 0.1, 0.2]))

    expect(brain.getSnapshot().state).toBe('idle')

    let snapshot = brain.update(120)

    expect(snapshot.state).toBe('walk')
    expect(snapshot.target).not.toBeNull()

    snapshot = brain.triggerReaction()
    expect(snapshot.state).toBe('react')

    snapshot = brain.update(200)
    expect(snapshot.state).toBe('idle')
  })

  it('keeps random targets within viewport bounds', () => {
    const rng = sequenceRng([0, 0.25, 0.5, 0.75, 0.99])

    for (let index = 0; index < 25; index += 1) {
      const target = pickRandomTarget(bounds, rng)

      expect(target.x).toBeGreaterThanOrEqual(bounds.minX)
      expect(target.x).toBeLessThanOrEqual(bounds.maxX)
      expect(target.y).toBeGreaterThanOrEqual(bounds.minY)
      expect(target.y).toBeLessThanOrEqual(bounds.maxY)
    }
  })

  it('clamps the pet back into bounds after resize', () => {
    const brain = new PetBrain(config, singleRectPetBounds(bounds), sequenceRng([0.95, 0.95, 0.95]))

    brain.update(1400)

    const smallerBounds: Bounds = { minX: 40, minY: 64, maxX: 150, maxY: 120 }
    const resized = brain.resize(singleRectPetBounds(smallerBounds))

    expect(resized.position).toEqual(clampPointToBounds(resized.position, smallerBounds))
  })

  it('forceIdle stops the pet and clears its target', () => {
    const brain = new PetBrain(config, singleRectPetBounds(bounds), sequenceRng([0.5, 0.5, 0.5]))
    brain.update(200) // 进入 walk 并产生 target

    const snapshot = brain.forceIdle()

    expect(snapshot.state).toBe('idle')
    expect(snapshot.target).toBeNull()
  })

  it('snaps a dead-zone point to the nearest real monitor', () => {
    const petBounds = deadZonePetBounds()

    // 副屏下方的死区点 (550, 220)：在并集 AABB 内，但不在任何真实屏内。
    const deadPoint = { x: 550, y: 220 }
    const snapped = clampToPetBounds(deadPoint, petBounds)

    // 应吸附进最近的真实屏（副屏 y∈[64,180]），y 被钳到 180。
    expect(snapped.y).toBeLessThanOrEqual(180)
    // 仍可能在副屏 x 范围内。
    expect(snapped.x).toBeGreaterThanOrEqual(400)
    expect(snapped.x).toBeLessThanOrEqual(720)
  })

  it('leaves a point untouched when it is inside a real monitor', () => {
    const petBounds = dualMonitorPetBounds()
    const inside = { x: 500, y: 100 }

    expect(clampToPetBounds(inside, petBounds)).toEqual(inside)
  })

  it('clamps a point outside the union into the nearest monitor', () => {
    const petBounds = singleRectPetBounds(bounds)
    const outside = { x: 9999, y: 9999 }
    const clamped = clampToPetBounds(outside, petBounds)

    expect(clamped).toEqual(clampPointToBounds(outside, bounds))
  })

  it('setPosition clamps to bounds and enters idle (drag)', () => {
    const brain = new PetBrain(config, singleRectPetBounds(bounds), sequenceRng([0.5]))

    // 拖到屏外（负坐标），应被钳进 bounds。
    const snapshot = brain.setPosition({ x: -100, y: -100 })

    expect(snapshot.state).toBe('idle')
    expect(snapshot.target).toBeNull()
    expect(snapshot.position.x).toBeGreaterThanOrEqual(bounds.minX)
    expect(snapshot.position.y).toBeGreaterThanOrEqual(bounds.minY)
  })
})

// 固定序列的 RNG，使状态机转换可断言。
function sequenceRng(sequence: number[]): () => number {
  let index = 0

  return () => {
    const value = sequence[index % sequence.length]
    index += 1
    return value
  }
}
