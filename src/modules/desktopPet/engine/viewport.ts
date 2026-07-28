// 视口边界工具：根据窗口尺寸与宠物足迹计算漫游 PetBounds。
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
// 单屏模式（preview / 取不到显示器）：全屏透明窗口从屏幕原点(0,0)铺起，macOS 菜单栏区也在窗口内。
// 顶部需要比侧/底更大的余量，确保精灵头顶与对话气泡不被窗口边缘视觉裁切。
//
// 多屏跨屏模式：透明窗口覆盖所有显示器并集，PetBounds 携带每块显示器的窗口局部矩形 monitors。
// math.ts 的 clampToPetBounds 会据此做「死区吸附」——脚位若落在任何显示器之外（死区），
// 就吸附到最近的真实显示器边缘，杜绝宠物在不规则多屏布局下消失。

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
 * 宠物漫游边界。aabb 是 monitors 的包围盒（粗边界，快速取舍用）；
 * monitors 是每块真实显示器的活动矩形，用于死区吸附（空数组时退化为纯 AABB 模式）。
 */
export interface PetBounds {
  /** 所有 monitors 的包围盒。monitors 为空时仍有效（直接作为唯一边界）。 */
  aabb: Bounds
  /** 真实显示器活动矩形列表（窗口局部逻辑坐标）。preview / 单屏回退时为 [aabb]。 */
  monitors: MonitorRect[]
}

/** 计算一个矩形（已含 footprint + padding）的脚位 Bounds。 */
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

/** 计算一组矩形的包围盒。空列表返回 null（调用方按空处理）。 */
function unionBounds(rects: Bounds[]): Bounds | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    if (r.minX < minX) minX = r.minX
    if (r.minY < minY) minY = r.minY
    if (r.maxX > maxX) maxX = r.maxX
    if (r.maxY > maxY) maxY = r.maxY
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 单矩形模式（preview / 取不到显示器时的回退）：直接由画布尺寸推导边界。
 * 保留与旧签名兼容，返回 PetBounds（monitors = [aabb]）。
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

/**
 * 输入显示器数据结构（来自 Tauri availableMonitors 的物理像素 + scaleFactor）。
 * 物理矩形 = { position: {x,y}, size: {width,height} }，scaleFactor 转逻辑像素。
 */
export interface MonitorInput {
  position: { x: number; y: number }
  size: { width: number; height: number }
  scaleFactor: number
}

/**
 * 多显示器模式：把每块显示器的物理矩形换算成「窗口局部逻辑坐标」的活动矩形，
 * 求并集作为粗边界，返回 PetBounds（monitors 非空，触发死区吸附）。
 *
 * 坐标换算：显示器在虚拟桌面中的物理原点 - 窗口物理原点，再除以窗口单一 scaleFactor，
 * 得到该显示器在 PixiJS 画布（逻辑坐标）中的左上角与尺寸。与 createPetApp 的
 * resolution: devicePixelRatio 渲染坐标系一致。
 *
 * @param monitors        显示器列表（物理像素 + 各自 scaleFactor）
 * @param winOriginPhysical 窗口物理原点（outerPosition，物理像素）
 * @param windowScale     窗口单一 scaleFactor（决定 PixiJS 逻辑坐标系比例）
 * @param footprint       宠物足迹估算
 */
export function createMultiMonitorBounds(
  monitors: MonitorInput[],
  winOriginPhysical: { x: number; y: number },
  windowScale: number,
  footprint: { halfWidth: number; height: number }
): PetBounds {
  if (windowScale <= 0 || monitors.length === 0) {
    // 无有效数据 → 返回退化空边界，调用方应回退到 createViewportBounds。
    return { aabb: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, monitors: [] }
  }

  const rects: MonitorRect[] = monitors.map((m) => {
    // 每块显示器用自己的 scaleFactor 换算物理→逻辑尺寸（其自身宽高的逻辑像素）。
    const monScale = m.scaleFactor > 0 ? m.scaleFactor : windowScale
    const logicalW = m.size.width / monScale
    const logicalH = m.size.height / monScale
    // 该显示器左上角在窗口局部逻辑坐标系中的位置：物理偏移除以窗口 scaleFactor。
    const localX = (m.position.x - winOriginPhysical.x) / windowScale
    const localY = (m.position.y - winOriginPhysical.y) / windowScale
    return rectToBounds(localX, localY, logicalW, logicalH, footprint)
  })

  const aabb = unionBounds(rects) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { aabb, monitors: rects }
}
