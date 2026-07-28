// 宠物 PixiJS 应用引导。
//
// 改自 pixi-pet-demo/src/app/createDemoApp.ts。核心差异（适配桌面宠物悬浮窗）：
//   - 不再渲染 demo 的 DOM 操作菜单 / 选择器 —— 那些交互由 Vue 视图（右键菜单、设置页）承担。
//   - 暴露 switchPet(src)/playAction(action)/triggerReaction()/destroy() 给外部调用。
//   - 画布点击宠物触发 triggerReaction（点击反馈），由视图决定是否还要开菜单。

import { Application, Container, Rectangle } from 'pixi.js'
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window'

import { CODEX_CELL_HEIGHT, CODEX_CELL_WIDTH } from './codexAtlas'
import { defaultPetConfig } from './petConfig'
import { PetController } from './PetController'
import { createMultiMonitorBounds, createViewportBounds } from './viewport'

import type { MonitorInput, PetBounds } from './viewport'
import type { PetConfig } from './types'

export interface PetAppOptions {
  /** 初始宠物 id。 */
  initialPetId: string
  /** 初始精灵图源（convertFileSrc 产出、保留 .webp 扩展名）。 */
  initialSpritesheetSrc: string
  /** 可选配置覆盖（缩放/速度等）。 */
  config?: Partial<PetConfig>
  /**
   * 预览模式：true 时画布点击只触发动作、不调用 onPetTap（用于详情/设置预览，避免开菜单）；
   * 不挂全局 window resize 监听（改由 destroy 外部按需调 resize）。默认 false（宠物悬浮窗）。
   */
  preview?: boolean
}

export interface PetApp {
  /** 切换宠物。id 与源都必须提供（可能需要异步加载新精灵图）。 */
  switchPet: (id: string, spritesheetSrc: string) => Promise<void>
  /** 手动播放一个动画动作（如 'waving'）。 */
  playAction: (actionId: string) => void
  /** 触发一次点击反馈（react burst）。 */
  triggerReaction: () => void
  /** 命中测试宠物精灵（用于视图层区分点击 vs 空白）。 */
  hitTest: (x: number, y: number) => boolean
  /** 返回宠物精灵在窗口逻辑坐标中的包围盒（用于动态穿透点击检测）。 */
  getPetBounds: () => { minX: number; minY: number; maxX: number; maxY: number }
  /** 强制重算视口（窗口/显示器尺寸或 DPI 变化时调用）。非 preview 模式下为异步（查显示器）。 */
  resize: () => Promise<void>
  /**
   * 拖拽宠物到窗口内指定脚位（CSS px）。内部 clamp 进当前 PetBounds，
   * 拖不到屏外/死区。松手后从该位置继续漫游。
   */
  dragTo: (x: number, y: number) => void
  /** 销毁 Pixi 应用并释放纹理。 */
  destroy: () => Promise<void>
  /** 当前宠物 id。 */
  readonly currentPetId: string
  /**
   * 鼠标进入/离开宠物精灵的回调（仅非预览模式生效）。视图据此触发对话气泡等交互。
   * 由前端 click-through 轮询驱动（穿透态下窗口收不到 pointermove）。
   */
  onPetHoverChange?: (inside: boolean) => void
  // --- 对话气泡（模拟 SSE，后续接入 ACP）-------------------------------
  /** 开始流式对话输出。 */
  showChat: () => void
  /** 追加一个流式 token。 */
  appendChatToken: (token: string) => void
  /** 结束流式。 */
  endChat: () => void
  /** 隐藏对话气泡。 */
  hideChat: () => void
}

// 静态足迹估算（基于 atlas 单元尺寸），可在异步精灵图加载完成前定尺寸漫游 Bounds
// （PetController 建好后也提供 live footprint，用于 resize）。
function footprintEstimate(config: PetConfig) {
  return {
    halfWidth: (config.scale * CODEX_CELL_WIDTH) / 2,
    height: config.scale * CODEX_CELL_HEIGHT,
  }
}

// 在给定 host 元素内 bootstrap Pixi 应用，加载初始宠物，返回可控制的 PetApp。
export async function createPetApp(
  host: HTMLElement,
  options: PetAppOptions
): Promise<PetApp> {
  const config: PetConfig = { ...defaultPetConfig, ...options.config }
  const preview = options.preview ?? false

  const app = new Application()

  await app.init({
    antialias: false,
    autoDensity: true,
    backgroundAlpha: 0, // 透明画布，让透明窗口背景透出桌面
    resizeTo: host,
    resolution: window.devicePixelRatio || 1,
  })

  app.canvas.classList.add('desktop-pet-canvas')
  host.appendChild(app.canvas)

  const scene = new Container()
  app.stage.addChild(scene)
  app.stage.eventMode = 'static'
  app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height)

  /**
   * 解析当前漫游 PetBounds。
   *
   * - preview 模式（PetManager 预览容器）：用 PixiJS 画布尺寸，单矩形模式。
   * - 悬浮窗模式：查 Tauri availableMonitors + 窗口 outerPosition/scaleFactor，
   *   算多显示器并集（每块屏独立换算），触发死区吸附。取不到显示器时回退画布尺寸。
   */
  async function resolvePetBounds(footprint: { halfWidth: number; height: number }): Promise<PetBounds> {
    const canvasBounds = createViewportBounds(app.screen.width, app.screen.height, footprint)
    if (preview) return canvasBounds

    try {
      const win = getCurrentWindow()
      const [monitors, origin, windowScale] = await Promise.all([
        availableMonitors(),
        win.outerPosition(),
        win.scaleFactor(),
      ])
      if (monitors.length === 0 || windowScale <= 0) return canvasBounds

      const inputs: MonitorInput[] = monitors.map((m) => ({
        position: { x: m.position.x, y: m.position.y },
        size: { width: m.size.width, height: m.size.height },
        scaleFactor: m.scaleFactor,
      }))
      const multi = createMultiMonitorBounds(inputs, { x: origin.x, y: origin.y }, windowScale, footprint)
      // monitors 为空（计算退化）时回退画布尺寸。
      return multi.monitors.length > 0 ? multi : canvasBounds
    } catch (error) {
      console.warn('[createPetApp] resolve multi-monitor bounds failed, fallback to canvas:', error)
      return canvasBounds
    }
  }

  const initialBounds = createViewportBounds(app.screen.width, app.screen.height, footprintEstimate(config))

  // 加载初始宠物。失败时在控制台报错并向上抛，调用方负责显示降级 UI。
  // 先用画布估算 bounds 让 PetBrain 能初始化，下方 resolvePetBounds 会立刻重算真实多屏边界。
  const pet = await PetController.create(
    app.renderer,
    options.initialPetId,
    options.initialSpritesheetSrc,
    initialBounds,
    config
  )
  scene.addChild(pet.view)

  // 立即按真实显示器数据重算 bounds（悬浮窗模式；preview 为画布尺寸，等价重算）。
  pet.resize(
    await resolvePetBounds(pet.footprint),
    app.screen.width,
    app.screen.height
  )

  // 画布指针编排：
  //   - pointerdown 命中宠物 → triggerReaction（按压反馈）。是否开动作菜单由视图层在
  //     pointerup 时按"未拖拽的干净单击"判定，避免拖动时误弹菜单。
  //   - 预览模式：命中后直接播放 wave 动作做反馈。
  //   - 悬停检测（onPetHoverChange）由前端 click-through 轮询驱动 —— 穿透态下窗口
  //     收不到 pointermove，Pixi 的 pointermove 不可靠，故不在此绑定。
  app.stage.on('pointerdown', (event) => {
    const hitPet = pet.handlePointerTap(event.global.x, event.global.y)
    if (hitPet) {
      pet.triggerReaction()
      if (preview) {
        pet.playAction('waving')
      }
    }
  })

  // syncViewport：重算 Pixi 画布尺寸 + hitArea，并按真实显示器重算 PetBounds。
  // 设为异步并加防重入锁，避免连续 resize 事件并发触发多次 availableMonitors 查询。
  let syncing = false
  let pending = false
  const syncViewport = async (): Promise<void> => {
    if (syncing) {
      pending = true
      return
    }
    syncing = true
    try {
      app.resize()
      app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height)
      const bounds = await resolvePetBounds(pet.footprint)
      pet.resize(bounds, app.screen.width, app.screen.height)
    } finally {
      syncing = false
      if (pending) {
        pending = false
        void syncViewport()
      }
    }
  }

  // 悬浮窗模式：DOM resize + Tauri 窗口 onResized/onScaleChanged 三路保险。
  // 后两者覆盖「拔插显示器 / 改分辨率 / 跨屏拖动导致窗口尺寸变化」等 Pixi 自动 resize 未捕获的场景。
  const win = preview ? null : getCurrentWindow()
  const unlistenResized = preview
    ? null
    : await win!.onResized(() => {
        void syncViewport()
      })
  const unlistenScaleChanged = preview
    ? null
    : await win!.onScaleChanged(() => {
        void syncViewport()
      })

  if (!preview) {
    window.addEventListener('resize', syncViewport)
  }

  app.ticker.add(() => {
    pet.update(app.ticker.deltaMS)
  })

  const petApp: PetApp = {
    switchPet: (id, src) => pet.switchPet(id, src),
    playAction: (actionId) => pet.playAction(actionId),
    triggerReaction: () => pet.triggerReaction(),
    hitTest: (x, y) => pet.handlePointerTap(x, y),
    getPetBounds: () => pet.getPetBounds(),
    resize: syncViewport,
    dragTo: (x, y) => pet.dragTo(x, y),
    showChat: () => pet.showChat(),
    appendChatToken: (token) => pet.appendChatToken(token),
    endChat: () => pet.endChat(),
    hideChat: () => pet.hideChat(),
    destroy: async () => {
      unlistenResized?.()
      unlistenScaleChanged?.()
      if (!preview) {
        window.removeEventListener('resize', syncViewport)
      }
      app.ticker.stop()
      pet.destroy()
      await app.destroy(true, {
        children: true,
        texture: true,
        textureSource: true,
      })
    },
    get currentPetId() {
      return pet.currentPetId
    },
  }

  return petApp
}

export { createViewportBounds }
export type { PetBounds, MonitorRect, MonitorInput } from './viewport'
