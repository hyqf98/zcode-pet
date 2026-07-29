// 视口边界工具：根据画布尺寸与宠物足迹计算漫游 PetBounds。
//
// 坐标约定（见 PetController.getPetBounds）：position 是宠物「脚位」，
// 精灵从脚位向上画 footprint.height 像素，水平以脚位为中心左右各 halfWidth。
//
// 边界含义：
//   minX/maxX —— 脚位水平范围。脚位在 [minX, maxX] 时，精灵左右边缘各留 padding。
//   minY      —— 脚位垂直下限。脚位 = minY 时，精灵头顶 = minY - height = topPadding。
//                （精灵头顶到画布顶部的安全余量，避免被窗口顶部/菜单栏盖住）
//   maxY      —— 脚位垂直上限（= 窗口底 - padding），保证脚不溢出底部。
//
// 窗口恒为「单屏铺满当前显示器」（macOS 下跨屏超大窗口在副屏不可见，故采用单屏 + 跨屏迁移），
// 因此 PixiJS 画布尺寸 = 当前屏可视区，直接由画布尺寸推导单矩形 PetBounds（monitors = [aabb]）。
// 多屏漫游由 PetCrossMonitorMigrator 独立处理（检测宠物跨屏 → 迁移窗口 → 重映射坐标）。
//
// PetBounds.monitors 在单屏模式下为 [aabb]；math.ts 的 clampToPetBounds 据此钳制宠物脚位
// 不越出当前屏。移动期 clamp 保证即便 bounds 算错或坐标异常，宠物也恒在可视区内。

import type { Bounds } from './types'

/** 水平/底部安全边距（精灵边缘到窗口/显示器边）。 */
const SIDE_PADDING = 16
/** 顶部安全边距（精灵头顶到窗口/显示器顶部）。全屏窗顶部覆盖菜单栏区，需更大余量。 */
const TOP_PADDING = 40

/**
 * 单块显示器（或整个画布）在窗口局部逻辑坐标系中的漫游矩形。
 * 已套用 footprint + padding，是宠物「脚位」的合法活动范围。
 */
export interface MonitorRect extends Bounds {}

/**
 * 宠物漫游边界。aabb 是粗边界（快速取舍用）；monitors 是真实活动矩形列表，
 * 用于死区吸附（单屏模式下 monitors = [aabb]，退化为普通 AABB 钳制）。
 */
export interface PetBounds {
  /** 漫游包围盒。单屏模式下即唯一活动矩形。 */
  aabb: Bounds
  /** 真实活动矩形列表（窗口局部逻辑坐标）。单屏模式 = [aabb]。 */
  monitors: MonitorRect[]
}

/** 计算一个矩形（原点 + 尺寸，已含 footprint + padding）的脚位 Bounds。 */
function rectToBounds(
  originX: number,
  originY: number,
  width: number,
  height: number,
  footprint: { halfWidth: number; height: number },
  side: number = SIDE_PADDING,
  top: number = TOP_PADDING
): Bounds {
  return {
    minX: originX + footprint.halfWidth + side,
    maxX: Math.max(originX + footprint.halfWidth + side, originX + width - footprint.halfWidth - side),
    // 脚位下限：保证精灵头顶 = minY - height ≥ top。
    minY: originY + footprint.height + top,
    maxY: Math.max(originY + footprint.height + top, originY + height - side),
  }
}

/**
 * 由画布尺寸推导漫游 PetBounds（单矩形模式）。
 * preview 预览 / 悬浮窗均用此：窗口已铺满当前屏，画布尺寸 = 屏可视区。
 */
export function createViewportBounds(
  width: number,
  height: number,
  footprint: { halfWidth: number; height: number },
  _padding = SIDE_PADDING
): PetBounds {
  const aabb = rectToBounds(0, 0, width, height, footprint, Math.max(_padding, SIDE_PADDING))
  return { aabb, monitors: [aabb] }
}
