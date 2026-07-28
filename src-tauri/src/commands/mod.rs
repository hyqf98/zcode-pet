// 命令层入口（commands module 根）。
//
// 遵循 tauri-harness 后端规范：commands 层是薄入口，参数校验 → service → DTO。
// 本应用当前只有 desktop_pet 一个命令模块。

pub mod desktop_pet;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 获取应用持久化数据目录（<app_data>/pets 的根）。
///
/// 使用 Tauri 标准的 `app.path().app_data_dir()`，替代原项目自定义的 persistence 路径。
/// 开发模式指向 ~/Library/Application Support/io.github.hyqf.zcode-pet（macOS）。
pub fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))
}

/// 当前时间的 RFC3339 字符串（用于 meta.json 的 installed_at）。
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
