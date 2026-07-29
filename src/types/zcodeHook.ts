/**
 * ZCode → 桌面宠物事件载荷类型。
 *
 * 描述后端通过 `emit_to("pet", "zcode-pet:event")` 推送给前端的事件。
 * 载荷为 camelCase JSON，由本地的 Tauri 事件监听器反序列化得到。
 *
 * 本文件是纯类型定义，无运行时依赖，便于在 node 环境单测与跨模块复用。
 */

/**
 * ZCode 推送给宠物的全部事件名（字符串字面量联合）。
 *
 * - `SessionStart`：会话开始（启动 / 清空 / 压缩历史后）。
 * - `UserPromptSubmit`：用户提交了一条 prompt。
 * - `PreToolUse`：工具调用即将开始。
 * - `PermissionRequest`：工具需要用户授权。
 * - `PostToolUse`：工具调用成功结束。
 * - `PostToolUseFailure`：工具调用失败。
 * - `Stop`：本轮回答结束。
 */
export type ZCodeEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'

/**
 * ZCode → 宠物事件的载荷结构。
 *
 * 后端 emit 的 camelCase JSON；字段按事件类型选择性填充。
 * `event` 为宽 `string` 以容忍后端新增事件（未知事件由映射层返回 null 忽略），
 * 已知事件名见 {@link ZCodeEventName}。
 */
export interface ZCodePetEventPayload {
  /** 事件名（见 {@link ZCodeEventName}）。 */
  event: string
  /** 工具名（Write/Edit/Bash/...），工具类事件携带。 */
  toolName?: string
  /** 从 `tool_input.file_path` 抽出的文件路径（Read/Write/Edit/Failure）。 */
  filePath?: string
  /** 从 `tool_input.command` 抽出的命令（Bash）。 */
  command?: string
  /** 从 `tool_input.pattern` 抽出的搜索模式（Grep/Glob）。 */
  pattern?: string
  /** 从 `tool_input.description` 抽出的描述（Task/Agent 子代理）。 */
  description?: string
  /** 从 `tool_input.url` 抽出的网址（WebFetch）。 */
  url?: string
  /** 从 `tool_input.query` 抽出的搜索词（WebSearch）。 */
  query?: string
  /** 错误信息（PostToolUseFailure）。 */
  error?: string
  /** 本轮最后一条 assistant 消息（Stop）。 */
  lastAssistantMessage?: string
  /** 用户提交的 prompt 文本（UserPromptSubmit）。 */
  prompt?: string
  /** 会话来源（SessionStart）：'startup' | 'clear' | 'compact'。 */
  source?: string
}
