//! ZCode 使用统计：从本地 SQLite 库读取 token 使用量。
//!
//! 数据源：ZCode CLI 的 SQLite 数据库（默认 `~/.zcode/cli/db/db.sqlite`）。
//! 通过三级检测链解析路径（用户覆盖 → ZCODE_STORAGE_DIR 环境变量 → beta → 默认）。
//! 只读打开（`SQLITE_OPEN_READ_ONLY`），避免与 ZCode 主进程产生锁冲突。
//!
//! 路径决策链（与 ZCode 源码 `zcode.cjs` 一致）：
//! ```text
//! 0. 用户覆盖（<app_data>/zcode-data-dir.json）→ 最高优先级
//! 1. ZCODE_STORAGE_DIR 环境变量
//! 2. ~/.zcode-beta（beta 版自动切换）
//! 3. ~/.zcode（默认）
//! ```

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use chrono::{Datelike, TimeZone};

/// 用户覆盖的数据目录路径存储文件名（位于 app_data_dir 下）。
const DATA_DIR_OVERRIDE_FILE: &str = "zcode-data-dir.json";

// ---------------------------------------------------------------------------
// DTO（serde camelCase，与前端 TypeScript 类型对齐）
// ---------------------------------------------------------------------------

/// 单个模型的 token 使用统计行。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokenRow {
    /// 模型标识（如 "glm-5.2"）。
    pub model_id: String,
    /// 今日 API 调用次数。
    pub calls: u64,
    /// 今日该模型消耗的总 token 数。
    pub total_tokens: u64,
}

/// 今日 ZCode token 使用量汇总。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStats {
    /// 实际查询的数据库路径（供前端展示）。
    pub db_path: String,
    /// 今日输入 token 总量。
    pub today_input_tokens: u64,
    /// 今日输出 token 总量。
    pub today_output_tokens: u64,
    /// 今日计算总 token（input + output + reasoning + cache 等）。
    pub today_total_tokens: u64,
    /// 今日 API 调用总次数。
    pub today_calls: u64,
    /// 今日各模型 token 明细（按消耗降序）。
    pub active_models: Vec<ModelTokenRow>,
}

// ---------------------------------------------------------------------------
// 用户覆盖文件管理
// ---------------------------------------------------------------------------

/// 获取覆盖文件完整路径。
fn override_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(DATA_DIR_OVERRIDE_FILE))
}

/// 读取用户覆盖的数据目录路径（非空字符串才视为有效覆盖）。
fn read_override_dir(app: &AppHandle) -> Option<String> {
    let path = override_file_path(app)?;
    let content = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    v.get("dir")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 写入用户覆盖路径。`dir` 为 None 或空串时清除覆盖（恢复自动检测）。
///
/// 返回 `true` 表示写入后路径检测成功（DB 文件存在）。
pub fn write_override_dir(app: &AppHandle, dir: Option<&str>) -> Result<bool, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = data_dir.join(DATA_DIR_OVERRIDE_FILE);
    let v = serde_json::json!({ "dir": dir.unwrap_or("") });
    let json_str = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&file, json_str).map_err(|e| e.to_string())?;
    // 写入后立即验证路径是否可解析。
    Ok(resolve_db_path(app).is_some())
}

// ---------------------------------------------------------------------------
// 三级检测链
// ---------------------------------------------------------------------------

/// 解析 ZCode SQLite 数据库路径（用户覆盖 → 环境变量 → beta → 默认）。
///
/// 返回 `None` 表示所有路径都未找到有效 DB 文件。
pub fn resolve_db_path(app: &AppHandle) -> Option<PathBuf> {
    // 0. 用户覆盖（最高优先级）。
    if let Some(dir) = read_override_dir(app) {
        let p = PathBuf::from(&dir).join("cli").join("db").join("db.sqlite");
        if p.exists() {
            return Some(p);
        }
    }
    resolve_db_path_auto()
}

/// 纯自动检测（不含用户覆盖）：环境变量 → beta → 默认。
fn resolve_db_path_auto() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    // 1. ZCODE_STORAGE_DIR 环境变量（ZCode CLI 源码中定义）。
    if let Ok(dir) = std::env::var("ZCODE_STORAGE_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed)
                .join("cli")
                .join("db")
                .join("db.sqlite");
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. Beta 版目录（~/.zcode-beta）。
    let beta = home
        .join(".zcode-beta")
        .join("cli")
        .join("db")
        .join("db.sqlite");
    if beta.exists() {
        return Some(beta);
    }

    // 3. 默认目录（~/.zcode）。
    let default = home.join(".zcode").join("cli").join("db").join("db.sqlite");
    if default.exists() {
        return Some(default);
    }

    None
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/// 查询今日 ZCode token 使用量。
///
/// 以只读模式打开 ZCode SQLite 库，查询 `model_usage` 表中今日（本地时区零点起）的记录。
/// WAL 模式下多读一写不冲突；设 1s busy_timeout 容错短暂锁竞争。
pub fn query_today_stats(db_path: &Path) -> Result<TokenStats, String> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("打开数据库失败: {e}"))?;

    // 容错：ZCode 主进程正在写入时短暂等待。
    conn.busy_timeout(std::time::Duration::from_millis(1000))
        .map_err(|e| format!("设置超时失败: {e}"))?;

    // 本地时区今日零点的 UTC 毫秒时间戳（model_usage.started_at 为 UTC ms）。
    let now = chrono::Local::now();
    let today_start_ms = chrono::Local
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| now.timestamp_millis());
    // 今日汇总。
    let (input, output, total, calls): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(computed_total_tokens), 0),
                    COUNT(*)
             FROM model_usage
             WHERE started_at >= ?1",
            rusqlite::params![today_start_ms],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("查询今日用量失败: {e}"))?;

    // 今日各模型明细（按消耗降序）。
    let mut stmt = conn
        .prepare(
            "SELECT model_id, COUNT(*), COALESCE(SUM(computed_total_tokens), 0)
             FROM model_usage
             WHERE started_at >= ?1
             GROUP BY model_id
             ORDER BY 3 DESC",
        )
        .map_err(|e| format!("准备模型查询失败: {e}"))?;

    let active_models: Vec<ModelTokenRow> = stmt
        .query_map(rusqlite::params![today_start_ms], |row| {
            Ok(ModelTokenRow {
                model_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                calls: row.get::<_, i64>(1)? as u64,
                total_tokens: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u64,
            })
        })
        .map_err(|e| format!("查询模型用量失败: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(TokenStats {
        db_path: db_path.to_string_lossy().to_string(),
        today_input_tokens: input.max(0) as u64,
        today_output_tokens: output.max(0) as u64,
        today_total_tokens: total.max(0) as u64,
        today_calls: calls.max(0) as u64,
        active_models,
    })
}
