/**
 * ZCode 事件 → {@link NotificationSpec} 映射。
 *
 * 纯函数层：只产出 i18n `messageKey` + `params`（本地化由调用方执行），
 * 不调用 i18n、不读写状态、不产生副作用。
 *
 * 映射表（event → action / messageKey / params / severity / instant）：
 *
 * | event               | action         | messageKey          | params                                | severity | instant |
 * | ------------------- | -------------- | ------------------- | ------------------------------------- | -------- | ------- |
 * | SessionStart        | waving         | notif.session.greet | —                                     | info     | false   |
 * | UserPromptSubmit    | waiting        | notif.user.thinking | —                                     | info     | false   |
 * | PreToolUse (普通)   | running        | notif.tool.<tool>   | {file?/command?/pattern?/desc?/...}   | info     | false   |
 * | PreToolUse (子代理) | jumping        | notif.tool.subagent | {desc?}                               | info     | false   |
 * | PostToolUse         | review         | notif.tool.done*    | {tool, file?}                         | success  | false   |
 * | PostToolUseFailure  | failed         | notif.tool.failed   | {tool, error}                         | error    | true    |
 * | PermissionRequest   | jumping        | notif.perm.need     | {tool}                                | warn     | false   |
 * | Stop (有响应)       | waving         | notif.stop.done     | {line?}/fullText                      | info     | false   |
 * | Stop (无响应)       | failed         | notif.stop.empty    | —                                     | warn     | false   |
 *
 * 工具文案策略（PreToolUse）：按工具名选 i18n key，附目标参数（文件名/命令/模式/子代理描述/网址/搜索词），
 * 缺少目标时回退到通用 `notif.tool.start`（`正在 {tool}…`）。这让气泡显示「📖 读取 b.ts」「⚙️ 执行：cargo build」
 * 而非笼统的「正在 Read…」。PostToolUse 同理：带文件的工具完成时附文件名。
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

/** Bash 命令最大展示长度（命令可能很长，截断避免撑爆气泡）。 */
const COMMAND_MAX_LEN = 40

/** Grep/Glob 模式最大展示长度。 */
const PATTERN_MAX_LEN = 30

/** Task/子代理描述最大展示长度。 */
const DESCRIPTION_MAX_LEN = 40

/** 网址/搜索词最大展示长度。 */
const URL_MAX_LEN = 40

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

/** 截断文本到指定长度，超长尾部加省略号（长度含省略号）。 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, Math.max(1, maxLen - 1)) + '…'
}

/** 文件类工具（PreToolUse/PostToolUse 完成都附文件名）。 */
const FILE_TOOLS = new Set(['Read', 'read', 'Write', 'write', 'Edit', 'edit', 'MultiEdit', 'multiedit'])

/** 按工具名挑选「开始」的 messageKey + params。无具体目标时回退通用文案。 */
function mapToolStart(payload: ZCodePetEventPayload): {
  messageKey: string
  params?: Record<string, string>
} {
  const tool = payload.toolName ?? ''
  const toolLabel = tool || DEFAULT_TOOL_NAME
  const file = payload.filePath ? basename(payload.filePath) : undefined

  // 文件类：读取 / 写入 / 编辑（带文件名）。
  if (FILE_TOOLS.has(tool) && file) {
    // Read 偏「读取」，Write/MultiEdit 偏「写入」，Edit 偏「编辑」。
    const verbKey =
      tool === 'Read' || tool === 'read'
        ? 'notif.tool.read'
        : tool === 'Edit' || tool === 'edit'
          ? 'notif.tool.edit'
          : 'notif.tool.write'
    return { messageKey: verbKey, params: { file } }
  }

  // Bash：执行命令。
  if ((tool === 'Bash' || tool === 'bash') && payload.command) {
    return {
      messageKey: 'notif.tool.bash',
      params: { command: truncate(payload.command, COMMAND_MAX_LEN) },
    }
  }

  // Grep / Glob：搜索模式。
  if ((tool === 'Grep' || tool === 'grep' || tool === 'Glob' || tool === 'glob') && payload.pattern) {
    return {
      messageKey: 'notif.tool.search',
      params: { pattern: truncate(payload.pattern, PATTERN_MAX_LEN) },
    }
  }

  // Task / Agent（子代理）：描述。
  if (tool === 'Task' || tool === 'task' || tool === 'Agent' || tool === 'agent') {
    if (payload.description) {
      return {
        messageKey: 'notif.tool.subagent',
        params: { desc: truncate(payload.description, DESCRIPTION_MAX_LEN) },
      }
    }
    return { messageKey: 'notif.tool.subagent.generic' }
  }

  // WebFetch：抓取网页。
  if (tool === 'WebFetch' || tool === 'webfetch') {
    if (payload.url) {
      return { messageKey: 'notif.tool.webfetch', params: { url: truncate(payload.url, URL_MAX_LEN) } }
    }
    return { messageKey: 'notif.tool.webfetch.generic' }
  }

  // WebSearch：搜索。
  if (tool === 'WebSearch' || tool === 'websearch') {
    if (payload.query) {
      return { messageKey: 'notif.tool.websearch', params: { query: truncate(payload.query, URL_MAX_LEN) } }
    }
    return { messageKey: 'notif.tool.websearch.generic' }
  }

  // 兜底：通用「正在 {tool}…」；若有文件名则附上。
  if (file) {
    return { messageKey: 'notif.tool.start.file', params: { tool: toolLabel, file } }
  }
  return { messageKey: 'notif.tool.start', params: { tool: toolLabel } }
}

/** 按工具名挑选「完成」的 messageKey + params。文件类附文件名，其余通用。 */
function mapToolDone(payload: ZCodePetEventPayload): {
  messageKey: string
  params: Record<string, string>
} {
  const tool = payload.toolName ?? DEFAULT_TOOL_NAME
  const file = payload.filePath ? basename(payload.filePath) : undefined
  if (FILE_TOOLS.has(payload.toolName ?? '') && file) {
    return { messageKey: 'notif.tool.done.file', params: { tool, file } }
  }
  return { messageKey: 'notif.tool.done', params: { tool } }
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
      const { messageKey, params } = mapToolStart(payload)
      // 子代理（Task/Agent）派遣：用 jumping（跳跃=派出去了）而非 running。
      const isSubagent = payload.toolName === 'Task' || payload.toolName === 'task'
        || payload.toolName === 'Agent' || payload.toolName === 'agent'
      return {
        action: isSubagent ? 'jumping' : 'running',
        messageKey,
        params,
        severity: 'info',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }
    }

    case 'PostToolUse': {
      const { messageKey, params } = mapToolDone(payload)
      return {
        action: 'review',
        messageKey,
        params,
        severity: 'success',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
      }
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
      // 气泡高度跟随内容撑开，不做截断，有多少就显示多少。
      const fullResponse = payload.lastAssistantMessage?.trim()
      if (fullResponse && fullResponse.length > 0) {
        return {
          action: 'waving',
          messageKey: 'notif.stop.done',
          fullText: fullResponse,
          severity: 'info',
          minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
          appendTokenStats: true,
        }
      }
      // 无 AI 响应消息：可能模型请求失败或被中断，用 failed 动画提示异常结束。
      return {
        action: 'failed',
        messageKey: 'notif.stop.empty',
        severity: 'warn',
        minDisplayMs: DEFAULT_MIN_DISPLAY_MS,
        appendTokenStats: true,
      }
    }

    default:
      return null
  }
}
