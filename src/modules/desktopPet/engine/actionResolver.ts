/**
 * 漫游模式 × 动画适配。
 *
 * 固定模式（fixed）下，running 动画会播放「跑」的帧序列但宠物钉在原地，
 * 视觉上不协调（原地跑）。本模块将这类"位移暗示"动画降级为 idle，
 * 让固定模式下的宠物只做原地待机动作。
 */

import type { PetActionId } from '../notifications/types'
import type { MovementMode } from '@/stores/petSettings'

/**
 * 固定模式下需要降级的动画 id。
 *
 * running：暗示跑动，固定模式下原地跑不协调 → 降级为 idle。
 * 其他动画（waving/jumping/failed/waiting/review）都是原地动作，不受影响。
 */
const FIXED_MODE_DOWNGRADE: ReadonlySet<PetActionId> = new Set(['running'])

/** 降级目标：running → idle。 */
const DOWNGRADE_TARGET: PetActionId = 'idle'

/**
 * 根据漫游模式过滤动画 id。
 *
 * - free 模式：原样返回 action。
 * - fixed 模式：running → idle，其余不变。
 */
export function resolveAction(action: PetActionId, movementMode: MovementMode): PetActionId {
  if (movementMode === 'fixed' && FIXED_MODE_DOWNGRADE.has(action)) {
    return DOWNGRADE_TARGET
  }
  return action
}
