// 宠物数学工具：边界裁剪、随机目标点、距离、归一化、夹取。
// 从 pixi-pet-demo/src/pet/math.ts 原样移植，并扩展多屏「死区吸附」边界（PetBounds）。

import type { Bounds, Point, RandomSource } from './types'
import type { PetBounds } from './viewport'

export function clampPointToBounds(point: Point, bounds: Bounds): Point {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  }
}

/** 点是否落在某矩形内（含边界）。 */
function pointInRect(p: Point, r: Bounds): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY
}

/**
 * 把点钳制进 PetBounds。
 *
 * - monitors 非空（多屏模式）：若点已在某真实显示器矩形内则原样返回；
 *   否则吸附到「中心距离最近的显示器」的边缘内（死区规避）。
 *   因每帧位移约 1px（walkSpeed=76px/s @60fps），跨死区时表现为沿最近屏边平滑滑行，
 *   不会出现瞬移感。
 * - monitors 空（退化模式）：退化为对 aabb 的普通钳制。
 *
 * O(monitors)，monitors 通常 1~3 个，零成本。
 */
export function clampToPetBounds(point: Point, petBounds: PetBounds): Point {
  const { aabb, monitors } = petBounds

  // 先用粗边界快速判否：若连并集 AABB 都不在内，必然需要吸附。
  if (pointInRect(point, aabb) && monitors.some((m) => pointInRect(point, m))) {
    return { x: point.x, y: point.y }
  }

  if (monitors.length === 0) {
    return clampPointToBounds(point, aabb)
  }

  // 点在死区或并集外 → 吸附到中心最近的显示器边缘。
  let best: Bounds = monitors[0]!
  let bestDist = Infinity
  for (const m of monitors) {
    const cx = (m.minX + m.maxX) * 0.5
    const cy = (m.minY + m.maxY) * 0.5
    const d = Math.hypot(point.x - cx, point.y - cy)
    if (d < bestDist) {
      bestDist = d
      best = m
    }
  }
  return clampPointToBounds(point, best)
}

export function pickRandomTarget(
  bounds: Bounds,
  rng: RandomSource,
  current?: Point
): Point {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  if (width <= 0 || height <= 0) {
    return { x: bounds.minX, y: bounds.minY }
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = {
      x: bounds.minX + rng() * width,
      y: bounds.minY + rng() * height,
    }

    if (!current || distance(candidate, current) >= Math.min(width, height) * 0.18) {
      return candidate
    }
  }

  return {
    x: bounds.minX + width * 0.5,
    y: bounds.minY + height * 0.5,
  }
}

/**
 * 多屏目标点选取：先随机挑一块真实显示器，再在其内部取点（目标恒在真实屏内，
 * 从源头杜绝死区）。多屏时优先跨屏选点（鼓励宠物在不同屏间走动）；monitors 空时
 * 退化为对 aabb 的 pickRandomTarget。
 *
 * @param petBounds 漫游边界
 * @param rng       随机源
 * @param current   当前位置（用于避免原地踏步，可选）
 */
export function pickRandomMonitorTarget(
  petBounds: PetBounds,
  rng: RandomSource,
  current?: Point
): Point {
  const { aabb, monitors } = petBounds
  if (monitors.length === 0) {
    return pickRandomTarget(aabb, rng, current)
  }

  // 多块显示器时，有概率选「非当前所在屏」以鼓励跨屏漫游。
  let pool = monitors
  if (current && monitors.length > 1) {
    const others = monitors.filter((m) => !pointInRect(current, m))
    if (others.length > 0 && rng() < 0.5) {
      pool = others
    }
  }

  const target = pool[Math.floor(rng() * pool.length)] ?? monitors[0]!
  return pickRandomTarget(target, rng, current)
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y)

  if (length < 1e-6) {
    return { x: 0, y: 0 }
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }

  if (value > max) {
    return max
  }

  return value
}
