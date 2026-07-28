/**
 * 桌面宠物通知规格与相关基础类型。
 *
 * 本模块是「ZCode 事件 → 宠物通知」的纯逻辑层：不依赖 Vue / DOM / Tauri，
 * 仅产出可测试的数据结构与状态机。
 */

/** 严重级别：决定配色与是否即时抢断。 */
export type Severity = 'info' | 'success' | 'warn' | 'error'

/**
 * 宠物动画 id。
 *
 * 与引擎 `PET_ACTIONS` 的 id 对齐，但在此独立声明，避免通知层耦合到渲染引擎
 * （通知层不应 import `atlasPlayback`）。
 */
export type PetActionId =
  | 'idle'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

/**
 * 一条通知规格：事件经 eventMapper 映射后的产物，驱动宠物动画 + 气泡。
 *
 * 调用方（Vue composable）据此：
 * 1. 切换宠物到 `action` 动画；
 * 2. 用 `messageKey` + `params` 经 i18n 渲染气泡文案；
 * 3. 按 `severity` / `instant` 决定配色与是否走打字机。
 */
export interface NotificationSpec {
  /** 宠物动画 id。 */
  action: PetActionId
  /** i18n 文案 key（如 'notif.tool.start'）。 */
  messageKey: string
  /** i18n 参数（缺失的键由调用方决定缺省值）。 */
  params?: Record<string, string>
  /**
   * 完整正文（优先于 messageKey）。
   *
   * 当存在时，调用方直接用此文本做打字机（跳过 i18n），用于 Stop 事件
   * 携带 AI 最终响应的完整正文（按 SSE 逐字渲染）。
   * 不存在时回退到 `t(messageKey, params)`。
   */
  fullText?: string
  /** 严重级别。 */
  severity: Severity
  /** 是否即时显示（不走打字机，直接 setText）。error 默认 true。 */
  instant?: boolean
  /** 最短展示时长 ms（防抖用，默认 1200）。 */
  minDisplayMs?: number
}
