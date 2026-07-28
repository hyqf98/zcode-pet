// 统一错误处理。
//
// 本应用错误统一以 String 形式透出给前端（与 tauri-harness 约定：命令返回 Result<T, String>）。
// 内部业务错误用 anyhow 累积上下文，在命令边界转成 String。

use thiserror::Error;

/// 应用级错误枚举（可选，用于结构化错误处理）。
#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("序列化错误: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("HTTP 错误: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Tauri 错误: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
    }
}
