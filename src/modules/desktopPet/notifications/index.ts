/**
 * 桌面宠物通知模块统一出口。
 *
 * 纯逻辑层：事件映射（eventMapper）+ 通知队列（notificationQueue），
 * 不依赖 Vue / DOM / Tauri，便于在 node 环境单测。
 */

export type { NotificationSpec, PetActionId, Severity } from './types'
export { mapEvent } from './eventMapper'
export { createNotificationQueue } from './notificationQueue'
export type { NotificationQueue } from './notificationQueue'
