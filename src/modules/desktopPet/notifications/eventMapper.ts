/**
 * ZCode 事件 → {@link NotificationSpec} 映射。
 *
 * 纯函数层：只产出 i18n `messageKey` + `params`（本地化由调用方执行），
 * 不调用 i18n、不读写状态、不产生副作用。
 *
 * 映射表（event → action / messageKey / params / severity / instant）：
 *
 * | event               | action   | messageKey          | params                                | severity | instant |
 * | ------------------- | -------- | ------------------- | ------------------------------------- | -------- | ------- |
 * | SessionStart        | waving   | notif.session.greet | —                                     | info     | false   |
 * | UserPromptSubmit    | waiting  | notif.user.thinking | —                                     | info     | false   |
 * | PreToolUse          | running  | notif.tool.start    | {tool, file?}                         | info     | false   |
 * | PostToolUse         | review   | notif.tool.done     | {tool}                                | success  | false   |
 * | PostToolUseFailure  | failed   | notif.tool.failed   | {tool, error}                         | error    | true    |
 * | PermissionRequest   | jumping  | notif.perm.need     | {tool}                                | warn     | false   |
 * | Stop                | waving   | notif.stop.done     | {line?}                               | info     | false   |
 */

import type { ZCodePetEventPayload } from '@/types/zcodeHook'
import type { NotificationSpec } from './types'

/** 默认最短展示时长 ms（与队列层默认值一致）。 */
const DEFAULT_MIN_DISPLAY_MS = 2200

/** 工具名缺省占位（toolName 缺失时使用）。 */
const DEFAULT_TOOL_NAME = '工具'

/** 错误信息缺省占位（error 缺失时使用）。 */
const DEFAULT_ERROR_TEXT = '未知错误'

/** PostToolUseFailure 错误信息最大长度。 */
const FAILURE_ERROR_MAX_LEN = 80

/**
 * 从文件路径抽取 basename（'src/a/b.ts' → 'b.ts'）。
 *
 * 同时兼容 Windows 反斜杠与 POSIX 正斜杠；空串原样返回。
 */
function basename(path: string): string {
  if (!path) {
    return path
  }
  const normalized = path.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
}

/**
 * 主映射函数：事件载荷 → {@link NotificationSpec}。
 *
 * 返回的 spec 携带 i18n `messageKey` 与参数（本地化由调用方执行）；
 * 遇到未知事件名返回 `null`，调用方应忽略。
 *
 * 所有返回的 spec 默认 `minDisplayMs: 1200`（error 亦用默认）。
 */
export function mapEvent(payload: ZCodePetEventPayload): NotificationSpec | null {
  switch (payload.event) {
    case 'SessionStart':
      return {
        action: 'waving',
        messageKey: 'notif.session.greet',
        severity: 'info',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }

    case 'UserPromptSubmit':
      return {
        action: 'waiting',
        messageKey: 'notif.user.thinking',
        severity: 'info',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }

    case 'PreToolUse': {
      const params: Record<string, string> = {
        tool: payload.toolName ?? DEFAULT_TOOL_NAME,
      }
      const file = payload.filePath ? basename(payload.filePath) : undefined
      if (file) {
        params.file = file
      }
      return {
        action: 'running',
        messageKey: 'notif.tool.start',
        params,
        severity: 'info',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }
    }

    case 'PostToolUse':
      return {
        action: 'review',
        messageKey: 'notif.tool.done',
        params: { tool: payload.toolName ?? DEFAULT_TOOL_NAME },
        severity: 'success',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }

    case 'PostToolUseFailure': {
      const errorText = (payload.error ?? DEFAULT_ERROR_TEXT).slice(0, FAILURE_ERROR_MAX_LEN)
      return {
        action: 'failed',
        messageKey: 'notif.tool.failed',
        params: {
          tool: payload.toolName ?? DEFAULT_TOOL_NAME,
          error: errorText,
        },
        severity: 'error',
        instant: true,
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }
    }

    case 'PermissionRequest':
      return {
        action: 'jumping',
        messageKey: 'notif.perm.need',
        params: { tool: payload.toolName ?? DEFAULT_TOOL_NAME },
        severity: 'warn',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }

    case 'Stop': {
      // 优先渲染 AI 最终响应的完整正文（按 SSE 打字机逐字输出）。
      // 截断到合理长度（避免超长响应把气泡撑爆），保留首行 + 后续内容。
      const fullResponse = payload.lastAssistantMessage?.trim()
      if (fullResponse && fullResponse.length > 0) {
        // 截断：最多 120 字（约 2-3 行气泡内容），超长尾部加省略号。
        const truncated =
          fullResponse.length > 120
            ? fullResponse.slice(0, 120) + '…'
            : fullResponse
        return {
          action: 'waving',
          messageKey: 'notif.stop.done',
          fullText: truncated,
          severity: 'info',
          minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
        }
      }
      // 无 AI 响应消息：回退固定文案。
      return {
        action: 'waving',
        messageKey: 'notif.stop.done',
        severity: 'info',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }
    }

    default:
      return null
  }
}
