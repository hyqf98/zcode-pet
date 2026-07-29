//! ZCode hook 输入与事件载荷的数据结构。
//!
//! 设计要点：
//! - [`ZCodeHookInput`] 对 ZCode 转发的 JSON 做宽松反序列化（所有字段容错），
//!   避免因字段缺失或类型不符而丢失事件。
//! - [`ZCodePetEvent`] 是透传给前端 pet 窗口的精简载荷，统一 `camelCase`，
//!   并跳过值为 `None` 的字段，减小 IPC 体积。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// ZCode hook 转发来的原始输入（宽松反序列化，所有字段容错）。
///
/// 只有 [`ZCodeHookInput::hook_event_name`] 是必有的；其余字段依事件类型而定，
/// 全部用 `Option` + `#[serde(default)]` 兜底。
#[derive(Debug, Clone, Deserialize)]
pub struct ZCodeHookInput {
    /// hook 事件名（SessionStart / PreToolUse / ... / Stop），必有。
    #[serde(default)]
    pub hook_event_name: String,
    /// 工具名（PreToolUse / PostToolUse / PermissionRequest / PostToolUseFailure）。
    #[serde(default)]
    pub tool_name: Option<String>,
    /// 工具输入，常含 `file_path`（PreToolUse / PostToolUse）。
    #[serde(default)]
    pub tool_input: Option<Value>,
    /// 工具响应（PostToolUse）。后端反序列化但不消费，为契约完整性保留供未来扩展。
    #[serde(default)]
    #[allow(dead_code)]
    pub tool_response: Option<Value>,
    /// 失败原因（PostToolUseFailure）。
    #[serde(default)]
    pub error: Option<String>,
    /// assistant 末条消息（Stop）。
    #[serde(default)]
    pub last_assistant_message: Option<String>,
    /// 用户提交的 prompt（UserPromptSubmit）。
    #[serde(default)]
    pub prompt: Option<String>,
    /// 会话来源（SessionStart：startup / clear / compact）。
    #[serde(default)]
    pub source: Option<String>,
    /// 会话 ID（通用）。反序列化保留，后端不消费。
    #[serde(default)]
    #[allow(dead_code)]
    pub session_id: Option<String>,
    /// 当前工作目录（通用）。反序列化保留，后端不消费。
    #[serde(default)]
    #[allow(dead_code)]
    pub cwd: Option<String>,
}

/// 透传给前端 pet 窗口的事件载荷（camelCase，供 TS 消费）。
///
/// 由 [`ZCodeHookInput::to_pet_event`] 构造，只保留前端动画/气泡关心的字段。
/// 除 `file_path` 外，按工具类型从 `tool_input` 额外抽取描述字段（command/pattern/description/url/query），
/// 供前端按工具渲染更具体的气泡文案（如 Bash 显示命令、Task 显示子代理描述）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodePetEvent {
    /// 事件名（SessionStart / PreToolUse / ... / Stop）。
    pub event: String,
    /// 工具名（如 Write / Edit / Bash）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// 从 `tool_input.file_path` 抽出的文件名（Read/Write/Edit 等）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// 从 `tool_input.command` 抽出的命令（Bash）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// 从 `tool_input.pattern` 抽出的搜索模式（Grep / Glob）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// 从 `tool_input.description` 抽出的描述（Task / Agent 子代理）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 从 `tool_input.url` 抽出的网址（WebFetch）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 从 `tool_input.query` 抽出的搜索词（WebSearch）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    /// 失败原因（PostToolUseFailure）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// assistant 末条消息（Stop）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_assistant_message: Option<String>,
    /// 用户 prompt（UserPromptSubmit）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// 会话来源（SessionStart）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl ZCodeHookInput {
    /// 将宽松的 hook 输入转换为精简的、供前端消费的事件载荷。
    ///
    /// `file_path` 从 `tool_input.file_path` 抽取（若有）；
    /// 另按工具常用字段抽取 `command`/`pattern`/`description`/`url`/`query`，
    /// 供前端按工具渲染更具体的气泡文案。其余字段直接映射。
    pub fn to_pet_event(&self) -> ZCodePetEvent {
        let file_path = self
            .tool_input
            .as_ref()
            .and_then(|v| v.get("file_path"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let command = self
            .tool_input
            .as_ref()
            .and_then(|v| v.get("command"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let pattern = self
            .tool_input
            .as_ref()
            .and_then(|v| v.get("pattern"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let description = self
            .tool_input
            .as_ref()
            .and_then(|v| v.get("description"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let url = self
            .tool_input
            .as_ref()
            .and_then(|v| v.get("url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let query = self
            .tool_input
            .as_ref()
            .and_then(|v| v.get("query"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        ZCodePetEvent {
            event: self.hook_event_name.clone(),
            tool_name: self.tool_name.clone(),
            file_path,
            command,
            pattern,
            description,
            url,
            query,
            error: self.error.clone(),
            last_assistant_message: self.last_assistant_message.clone(),
            prompt: self.prompt.clone(),
            source: self.source.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_to_pet_event_extracts_file_path() {
        let input = ZCodeHookInput {
            hook_event_name: "PreToolUse".to_string(),
            tool_name: Some("Write".to_string()),
            tool_input: Some(json!({ "file_path": "/tmp/a.rs" })),
            tool_response: None,
            error: None,
            last_assistant_message: None,
            prompt: None,
            source: None,
            session_id: Some("s1".to_string()),
            cwd: Some("/tmp".to_string()),
        };
        let ev = input.to_pet_event();
        assert_eq!(ev.event, "PreToolUse");
        assert_eq!(ev.tool_name.as_deref(), Some("Write"));
        assert_eq!(ev.file_path.as_deref(), Some("/tmp/a.rs"));
    }

    #[test]
    fn test_to_pet_event_without_file_path() {
        let input = ZCodeHookInput {
            hook_event_name: "Stop".to_string(),
            tool_name: None,
            tool_input: None,
            tool_response: None,
            error: None,
            last_assistant_message: Some("done".to_string()),
            prompt: None,
            source: None,
            session_id: None,
            cwd: None,
        };
        let ev = input.to_pet_event();
        assert_eq!(ev.event, "Stop");
        assert!(ev.file_path.is_none());
        assert_eq!(ev.last_assistant_message.as_deref(), Some("done"));
    }

    #[test]
    fn test_loose_deserialize_missing_fields() {
        // 只有 hook_event_name，其余字段缺失也能解析。
        let raw = r#"{"hook_event_name":"SessionStart","source":"startup"}"#;
        let input: ZCodeHookInput = serde_json::from_str(raw).unwrap();
        assert_eq!(input.hook_event_name, "SessionStart");
        assert_eq!(input.source.as_deref(), Some("startup"));
        assert!(input.tool_name.is_none());
        assert!(input.prompt.is_none());
    }

    #[test]
    fn test_pet_event_camel_case_and_skip_none() {
        // 用带值的字段验证 camelCase 命名（None 会被跳过，无法验证键名）。
        let ev = ZCodePetEvent {
            event: "Stop".to_string(),
            tool_name: None,
            file_path: None,
            command: None,
            pattern: None,
            description: None,
            url: None,
            query: None,
            last_assistant_message: Some("done".to_string()),
            prompt: Some("hi".to_string()),
            source: None,
            error: None,
        };
        let s = serde_json::to_string(&ev).unwrap();
        // camelCase 键：last_assistant_message → lastAssistantMessage。
        assert!(s.contains("\"lastAssistantMessage\":\"done\""));
        // None 字段被跳过。
        assert!(!s.contains("toolName"));
        assert!(!s.contains("filePath"));
        assert!(!s.contains("command"));
        assert!(!s.contains("pattern"));
        assert!(!s.contains("description"));
        assert!(!s.contains("\"error\""));
        assert!(!s.contains("\"source\""));
        assert!(s.contains("\"prompt\":\"hi\""));
        assert!(s.contains("\"event\":\"Stop\""));
    }

    #[test]
    fn test_to_pet_event_extracts_rich_tool_fields() {
        // Bash：抽 command；Task：抽 description；其余工具缺省字段为 None。
        let input = ZCodeHookInput {
            hook_event_name: "PreToolUse".to_string(),
            tool_name: Some("Bash".to_string()),
            tool_input: Some(json!({ "command": "cargo build" })),
            tool_response: None,
            error: None,
            last_assistant_message: None,
            prompt: None,
            source: None,
            session_id: None,
            cwd: None,
        };
        let ev = input.to_pet_event();
        assert_eq!(ev.command.as_deref(), Some("cargo build"));
        assert!(ev.file_path.is_none());

        let input2 = ZCodeHookInput {
            hook_event_name: "PreToolUse".to_string(),
            tool_name: Some("Task".to_string()),
            tool_input: Some(json!({ "description": "search codebase" })),
            tool_response: None,
            error: None,
            last_assistant_message: None,
            prompt: None,
            source: None,
            session_id: None,
            cwd: None,
        };
        let ev2 = input2.to_pet_event();
        assert_eq!(ev2.description.as_deref(), Some("search codebase"));
    }
}
