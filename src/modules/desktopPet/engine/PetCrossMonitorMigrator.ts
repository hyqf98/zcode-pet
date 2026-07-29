// 多屏跨屏迁移器（macOS 单屏窗口 + 跨屏迁移方案）。
//
// 背景：macOS 下单个透明窗口无法跨屏渲染（副屏不可见），故窗口恒铺满「宠物当前所在屏」。
// 本模块检测宠物是否接近当前屏边缘、且边缘外侧存在相邻显示器；若是，调用后端
// move_pet_window_to_monitor 把窗口迁移到邻屏，并把宠物重定位到邻屏对应边缘内侧，
// 实现无缝跨屏。
//
// 触发条件（关键）：不能等宠物物理坐标真的跨屏——宠物被单屏边界 clamp 钉在当前屏内，
// 永远不会跨过去。故改为：宠物接近活动边界（距 bounds 边 < EDGE_TRIGGER_PX）且该屏边缘
// 物理外侧有邻屏时，主动触发迁移。
//
// 防反向弹跳：迁移后宠物落在目标屏「进入边缘的相反侧」内侧（如从源屏左出 → 进目标屏右），
// 且距边缘足够远（inset > padding + EDGE_TRIGGER_PX），确保不会立即又触发反向迁移。
// 方向相反是因为相邻屏坐标系连续：源屏左边缘紧邻目标屏右边缘。

import { availableMonitors, currentMonitor, getCurrentWindow, monitorFromPoint } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'

import type { PetController } from './PetController'

/** move_pet_window_to_monitor 命令返回的窗口几何（物理 + 逻辑 + scale）。 */
interface WindowGeometry {
  originX: number
  originY: number
  width: number
  height: number
  logicalWidth: number
  logicalHeight: number
  scaleFactor: number
}

/** 迁移器依赖：拿到宠物位置 + 迁移后重算视口。 */
export interface MigratorDeps {
  pet: PetController
  onMigrated: () => void
}

/** 宠物距活动边界小于该值（逻辑像素）且外侧有邻屏时，触发迁移。 */
const EDGE_TRIGGER_PX = 24
/** 迁移采样间隔（ms）。 */
const TICK_INTERVAL_MS = 120
/** 连续两次迁移最小间隔（ms），防抖。 */
const MIN_MIGRATE_GAP_MS = 600
/** 宠物足迹半宽 + 侧边距（与 viewport.ts 的 footprint(72)+SIDE(16) 一致）。 */
const PADDING = 88

/**
 * 创建跨屏迁移器。返回 tick()，由引擎 ticker 周期调用（内部按 TICK_INTERVAL_MS 节流）。
 */
export function createCrossMonitorMigrator(deps: MigratorDeps) {
  const win = getCurrentWindow()
  let lastTickAt = 0
  let lastMigrateAt = 0
  let migrating = false

  async function tick(): Promise<void> {
    if (migrating) return
    const now = Date.now()
    if (now - lastTickAt < TICK_INTERVAL_MS) return
    lastTickAt = now
    if (now - lastMigrateAt < MIN_MIGRATE_GAP_MS) return

    try {
      // 1. 宠物当前画布坐标 + 活动边界（clamp 后的实际可达范围）。
      const pos = deps.pet.getSnapshotForMigration()
      const bounds = deps.pet.migrationBounds
      if (!pos || !bounds) return

      // 2. 窗口物理原点 + scale + 当前所在屏 + 显示器列表。
      const [origin, winScale, winMonitor, allMonitors] = await Promise.all([
        win.outerPosition(),
        win.scaleFactor(),
        currentMonitor(),
        availableMonitors(),
      ])
      if (winScale <= 0 || !winMonitor || allMonitors.length <= 1) return

      // 3. 判断宠物是否贴近活动边界的某条边。
      const atLeftEdge = pos.x <= bounds.minX + EDGE_TRIGGER_PX
      const atRightEdge = pos.x >= bounds.maxX - EDGE_TRIGGER_PX
      const atTopEdge = pos.y <= bounds.minY + EDGE_TRIGGER_PX
      const atBottomEdge = pos.y >= bounds.maxY - EDGE_TRIGGER_PX
      if (!atLeftEdge && !atRightEdge && !atTopEdge && !atBottomEdge) return

      // 4. 探测当前屏边缘「物理外侧」是否有邻屏。
      //    探测点必须在当前屏物理边界之外（monLeft-1 等），否则仍在当前屏内。
      const monPos = winMonitor.position
      const monSize = winMonitor.size
      const petPhysX = origin.x + pos.x * winScale
      const petPhysY = origin.y + pos.y * winScale
      const probes: Array<{ x: number; y: number }> = []
      if (atLeftEdge) probes.push({ x: monPos.x - 1, y: petPhysY })
      if (atRightEdge) probes.push({ x: monPos.x + monSize.width + 1, y: petPhysY })
      if (atTopEdge) probes.push({ x: petPhysX, y: monPos.y - 1 })
      if (atBottomEdge) probes.push({ x: petPhysX, y: monPos.y + monSize.height + 1 })

      let targetMonitor = null
      for (const p of probes) {
        const m = await monitorFromPoint(p.x, p.y)
        if (m && m.name !== winMonitor.name) {
          targetMonitor = m
          break
        }
      }
      if (!targetMonitor) return // 贴边但外侧无邻屏（屏幕物理边界）。

      // 5. 触发迁移：调后端把窗口迁到邻屏，拿新几何。
      migrating = true
      try {
        const geo = await invoke<WindowGeometry>('move_pet_window_to_monitor', {
          targetMonitorName: targetMonitor.name,
        })
        lastMigrateAt = Date.now()

        // 6. 重定位宠物到目标屏「进入边缘的相反侧」内侧，防反向弹跳。
        //    inset 须 > PADDING + EDGE_TRIGGER_PX，使 clamp 后位置不再满足 atEdge。
        const newScale = geo.scaleFactor > 0 ? geo.scaleFactor : winScale
        const newLogicalW = geo.logicalWidth > 0 ? geo.logicalWidth : geo.width / newScale
        const newLogicalH = geo.logicalHeight > 0 ? geo.logicalHeight : geo.height / newScale
        const inset = PADDING + EDGE_TRIGGER_PX + 60
        const clampX = (x: number) => Math.max(PADDING, Math.min(newLogicalW - PADDING, x))
        const clampY = (y: number) => Math.max(PADDING, Math.min(newLogicalH - PADDING, y))
        let newCanvasX: number
        let newCanvasY: number
        if (atLeftEdge) {
          // 源屏左出 → 目标屏右内侧
          newCanvasX = clampX(newLogicalW - inset)
          newCanvasY = clampY(pos.y)
        } else if (atRightEdge) {
          newCanvasX = clampX(inset)
          newCanvasY = clampY(pos.y)
        } else if (atTopEdge) {
          newCanvasX = clampX(pos.x)
          newCanvasY = clampY(newLogicalH - inset)
        } else {
          newCanvasX = clampX(pos.x)
          newCanvasY = clampY(inset)
        }

        deps.pet.dragTo(newCanvasX, newCanvasY)
        deps.onMigrated()
      } finally {
        migrating = false
      }
    } catch (error) {
      migrating = false
      console.warn('[CrossMonitorMigrator] migrate failed:', error)
    }
  }

  return { tick }
}
