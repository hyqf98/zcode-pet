//! 本地 HTTP 服务：接收 ZCode hook 转发脚本 POST 的事件，转发给 pet 窗口。
//!
//! 由 [`start`]（非阻塞）拉起：在 `127.0.0.1` 绑定一个随机端口，
//! 把端口号写入 [`port_file_path`]，供 hook 脚本读取。路由：
//! - `POST /hook`：解析事件 → `emit_to` pet 窗口（事件名 `zcode-pet:event`）。
//! - `GET /health`：健康检查。
//!
//! 注意：本服务只负责转发，不做任何业务决策；任何解析失败都返回 200，
//! 绝不阻断 ZCode 的 hook 流程。

use std::path::PathBuf;

use axum::body::Bytes;
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::models::ZCodeHookInput;

/// 桌面宠物悬浮窗口的标签（前端据此识别窗口类型）。
///
/// 与 `commands::desktop_pet::PET_WINDOW_LABEL` 保持一致；
/// 此处自行定义以避免与 `commands` 模块产生循环依赖。
pub const PET_WINDOW_LABEL: &str = "pet";

/// 端口文件名（写入 app_data 目录，供 hook 脚本读取端口号）。
const PORT_FILE_NAME: &str = "zcode-pet.port";

/// 发给 pet 窗口的事件名。
const PET_EVENT_NAME: &str = "zcode-pet:event";

/// 端口文件路径（`<app_data>/zcode-pet.port`）。
///
/// # 参数
/// - `app`: Tauri 应用句柄
///
/// # 返回
/// 成功返回端口文件路径，失败返回错误消息字符串。
pub fn port_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    Ok(data_dir.join(PORT_FILE_NAME))
}

/// 启动本地 HTTP 服务（非阻塞，立即返回）。
///
/// 在 Tauri 的异步运行时上 spawn 一个任务，绑定随机端口并将端口号写入端口文件，
/// 供 ZCode hook 转发脚本读取。任务内的错误仅通过 `tracing::error!` 记录，不 panic。
///
/// # 参数
/// - `app`: Tauri 应用句柄（克隆后移入异步任务）
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_server(app).await {
            tracing::error!("[ZCodeHook] HTTP 服务异常: {}", e);
        }
    });
}

/// 实际运行 axum 服务的异步逻辑（私有）。
async fn run_server(app: AppHandle) -> Result<(), String> {
    // 绑定随机端口（127.0.0.1:0 由系统分配）。
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("绑定本地端口失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取本地端口失败: {}", e))?
        .port();

    // 写端口文件（先确保父目录存在）。
    let port_file = port_file_path(&app)?;
    if let Some(parent) = port_file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建端口文件目录失败: {}", e))?;
    }
    std::fs::write(&port_file, port.to_string())
        .map_err(|e| format!("写入端口文件失败: {}", e))?;
    tracing::info!(
        "[ZCodeHook] HTTP 服务监听 127.0.0.1:{}（端口文件: {}）",
        port,
        port_file.display()
    );

    let router = Router::new()
        .route("/hook", post(handle_hook))
        .route("/health", get(health))
        .with_state(app);

    axum::serve(listener, router)
        .await
        .map_err(|e| format!("axum 服务退出: {}", e))?;
    Ok(())
}

/// 处理 hook 转发请求：解析输入 → 转换为事件 → emit 给 pet 窗口。
///
/// 采用原始字节（[`Bytes`]）接收 body 并手动解析，确保解析失败也返回 200，
/// 绝不阻断 ZCode 的 hook 流程。
async fn handle_hook(State(app): State<AppHandle>, body: Bytes) -> Json<Value> {
    match serde_json::from_slice::<ZCodeHookInput>(&body) {
        Ok(input) => {
            let pet_event = input.to_pet_event();
            tracing::debug!(
                event = %pet_event.event,
                tool = ?pet_event.tool_name,
                "收到 ZCode hook 事件"
            );
            if let Err(e) = app.emit_to(PET_WINDOW_LABEL, PET_EVENT_NAME, &pet_event) {
                tracing::warn!("[ZCodeHook] emit 事件到 pet 窗口失败: {}", e);
            }
        }
        Err(e) => {
            // 解析失败仅记录，仍返回 200，不阻断 ZCode。
            tracing::warn!(
                "[ZCodeHook] hook 输入解析失败（已忽略，返回 200）: {}",
                e
            );
        }
    }
    Json(json!({ "ok": true }))
}

/// 健康检查端点。
async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "zcode-pet" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pet_window_label_constant() {
        // 与 commands::desktop_pet::PET_WINDOW_LABEL 保持一致。
        assert_eq!(PET_WINDOW_LABEL, "pet");
    }

    #[test]
    fn test_event_and_port_file_constants() {
        assert_eq!(PORT_FILE_NAME, "zcode-pet.port");
        assert_eq!(PET_EVENT_NAME, "zcode-pet:event");
    }
}
