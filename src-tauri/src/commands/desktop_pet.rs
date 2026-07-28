// Desktop Pet 命令模块。
//
// 对接 https://codex-pets.net 的公共 API：搜索/详情/下载宠物精灵图，并在本地持久化
// 目录管理已安装的宠物（内置 4 只 + 用户下载）。同时负责创建/显示/隐藏一个独立、透明、
// 置顶、无边框的桌面宠物悬浮窗口（OS 级），让宠物浮在屏幕右下角。
//
// 约定遵循 tauri-harness 后端规范：导入 → 数据结构(camelCase) → 私有辅助 → #[tauri::command]，
// 命令返回 Result<T, String>，禁止 unwrap()/expect()。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

use super::{get_app_data_dir, now_rfc3339};

// --- 常量 ----------------------------------------------------------------

/// 桌面宠物悬浮窗口的标签（前端据此识别窗口类型）。
pub const PET_WINDOW_LABEL: &str = "pet";

/// codex-pets.net 公共 API 基址。
const PETSHARE_BASE: &str = "https://codex-pets.net";

/// 宠物悬浮窗口逻辑尺寸（容纳一只 192x208 的宠物按 0.75 缩放 + 走动留白）。
///
/// 全屏模式下不再用于构建窗口（窗口恒铺满整屏）。仅被 `position_bottom_right`
/// 备用定位逻辑引用，保留供未来「右下角小窗模式」复用。
#[allow(dead_code)]
const PET_WINDOW_WIDTH: f64 = 300.0;
#[allow(dead_code)]
const PET_WINDOW_HEIGHT: f64 = 320.0;

/// 右下角定位的右边距 / 下边距（逻辑像素）。下边距预留 macOS Dock / 任务栏空间。
///
/// 仅被 `position_bottom_right` 备用定位逻辑引用，全屏模式下未启用。
#[allow(dead_code)]
const PET_WINDOW_RIGHT_MARGIN: f64 = 24.0;
#[allow(dead_code)]
const PET_WINDOW_BOTTOM_MARGIN: f64 = 84.0;

/// 内置打包的 4 只宠物 id（资源在 src-tauri/resources/pets/<id>/）。
const BUILTIN_PET_IDS: &[&str] = &["ice-tea-hooper", "trump", "jige-kunkun", "fat-guga"];

// --- 数据结构（与前端共享，统一 camelCase） --------------------------------

/// codex-pets.net 返回的单只宠物摘要（列表项 / 详情项共用同一形状）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexPetSummary {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub spritesheet_url: Option<String>,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub share_image_url: Option<String>,
    #[serde(default)]
    pub view_count: Option<u64>,
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub like_count: Option<u64>,
    #[serde(default)]
    pub uploaded_at: Option<String>,
}

/// 列表接口的分页信封。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexPetListResponse {
    #[serde(default)]
    pub pets: Vec<CodexPetSummary>,
    #[serde(default)]
    pub page: u32,
    #[serde(default)]
    pub page_size: u32,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub total_pages: u32,
}

/// 详情接口的 { pet: {...} } 外层。
#[derive(Deserialize)]
struct CodexPetDetailEnvelope {
    pet: CodexPetSummary,
}

/// 落地的本地宠物元数据（meta.json 的结构）。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalPetMeta {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// "builtin"（内置打包）或 "downloaded"（用户从市场下载）。
    pub source: String,
    /// 精灵图文件名（始终为 "spritesheet.webp"）。
    pub spritesheet_file: String,
    #[serde(default)]
    pub poster_file: Option<String>,
    #[serde(default)]
    pub spritesheet_url: Option<String>,
    /// codex-pets 的版本号（uploadedAt 毫秒）。
    #[serde(default)]
    pub version: Option<u64>,
    #[serde(default)]
    pub installed_at: Option<String>,
}

/// 透出给前端的本地宠物信息（meta + 绝对路径，便于 convertFileSrc）。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalPetInfo {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub kind: Option<String>,
    pub tags: Vec<String>,
    pub source: String,
    pub spritesheet_path: String,
    pub poster_path: Option<String>,
    pub spritesheet_url: Option<String>,
    pub version: Option<u64>,
    pub installed_at: Option<String>,
}

// --- 私有辅助：路径与元数据 ----------------------------------------------

/// 本地宠物根目录：<app_data>/pets。
fn pets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_app_data_dir(app)?.join("pets");
    fs::create_dir_all(&dir).map_err(|e| format!("创建宠物目录失败: {}", e))?;
    Ok(dir)
}

/// 单只宠物的本地目录：<app_data>/pets/<id>。
fn pet_dir(app: &AppHandle, pet_id: &str) -> Result<PathBuf, String> {
    // 拒绝路径穿越：只允许小写字母/数字/连字符的 id。
    if !pet_id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("非法的宠物 id: {}", pet_id));
    }
    Ok(pets_dir(app)?.join(pet_id))
}

/// 读取某只宠物目录下的 meta.json。
fn read_meta(dir: &Path) -> Result<Option<LocalPetMeta>, String> {
    let meta_path = dir.join("meta.json");
    if !meta_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&meta_path)
        .map_err(|e| format!("读取 meta.json 失败: {}", e))?;
    let meta: LocalPetMeta = serde_json::from_str(&content)
        .map_err(|e| format!("解析 meta.json 失败: {}", e))?;
    Ok(Some(meta))
}

/// 写入 meta.json（pretty 格式，便于排查）。
fn write_meta(dir: &Path, meta: &LocalPetMeta) -> Result<(), String> {
    let meta_path = dir.join("meta.json");
    let content = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("序列化 meta.json 失败: {}", e))?;
    fs::write(&meta_path, content).map_err(|e| format!("写入 meta.json 失败: {}", e))?;
    Ok(())
}

/// meta + 目录 → 透出给前端的 LocalPetInfo（附带绝对路径）。
fn meta_to_info(dir: &Path, meta: &LocalPetMeta) -> LocalPetInfo {
    let spritesheet_path = dir.join(&meta.spritesheet_file);
    let poster_path = meta
        .poster_file
        .as_ref()
        .map(|name| dir.join(name).to_string_lossy().to_string());

    LocalPetInfo {
        id: meta.id.clone(),
        display_name: meta.display_name.clone(),
        description: meta.description.clone(),
        kind: meta.kind.clone(),
        tags: meta.tags.clone(),
        source: meta.source.clone(),
        spritesheet_path: spritesheet_path.to_string_lossy().to_string(),
        poster_path,
        spritesheet_url: meta.spritesheet_url.clone(),
        version: meta.version,
        installed_at: meta.installed_at.clone(),
    }
}

// --- 私有辅助：HTTP ------------------------------------------------------

/// 构造一个带超时的 reqwest 客户端（rustls）。
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

/// 把任意错误转成字符串（用于 ? 传播）。
fn err_str<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// --- 命令：codex-pets.net API -------------------------------------------

/// 搜索 codex-pets.net 宠物市场。透传 q/kind/sort/page/page_size 查询参数。
#[tauri::command]
pub async fn search_codex_pets(
    q: Option<String>,
    kind: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<CodexPetListResponse, String> {
    let client = http_client()?;
    let mut url = reqwest::Url::parse(&format!("{}/api/pets", PETSHARE_BASE))
        .map_err(|e| format!("解析 URL 失败: {}", e))?;
    {
        let mut query = url.query_pairs_mut();
        if let Some(q) = q {
            if !q.trim().is_empty() {
                query.append_pair("q", q.trim());
            }
        }
        if let Some(kind) = kind {
            if !kind.trim().is_empty() {
                query.append_pair("kind", kind.trim());
            }
        }
        if let Some(sort) = sort {
            if !sort.trim().is_empty() {
                query.append_pair("sort", sort.trim());
            }
        }
        if let Some(page) = page {
            query.append_pair("page", &page.to_string());
        }
        if let Some(page_size) = page_size {
            query.append_pair("pageSize", &page_size.to_string());
        }
    }

    let resp = client.get(url).send().await.map_err(err_str)?;
    if !resp.status().is_success() {
        return Err(format!("codex-pets 搜索失败: HTTP {}", resp.status()));
    }
    resp.json::<CodexPetListResponse>().await.map_err(err_str)
}

/// 获取单只宠物的详情（含完整的精灵图 URL 等）。
#[tauri::command]
pub async fn get_codex_pet_detail(pet_id: String) -> Result<CodexPetSummary, String> {
    let client = http_client()?;
    let url = format!(
        "{}/api/pets/{}",
        PETSHARE_BASE,
        urlencoding_path_segment(&pet_id)
    );
    let resp = client.get(&url).send().await.map_err(err_str)?;
    if !resp.status().is_success() {
        return Err(format!("codex-pets 详情失败: HTTP {}", resp.status()));
    }
    let envelope = resp.json::<CodexPetDetailEnvelope>().await.map_err(err_str)?;
    Ok(envelope.pet)
}

/// 下载某只宠物：拉详情 → 拉 spritesheet 字节 → 落盘到 pets/<id>/，并写 meta。
#[tauri::command]
pub async fn download_codex_pet(
    app: AppHandle,
    pet_id: String,
) -> Result<LocalPetInfo, String> {
    let detail = get_codex_pet_detail(pet_id.clone()).await?;

    let spritesheet_url = detail
        .spritesheet_url
        .clone()
        .ok_or_else(|| format!("宠物 {} 未提供 spritesheetUrl", pet_id))?;

    let client = http_client()?;
    let bytes = client
        .get(&spritesheet_url)
        .send()
        .await
        .map_err(err_str)?
        .bytes()
        .await
        .map_err(err_str)?;

    if bytes.is_empty() {
        return Err(format!("宠物 {} 的精灵图为空", pet_id));
    }

    // 落盘（异步 I/O，避免阻塞调度线程）。
    let dir = pet_dir(&app, &pet_id)?;
    let spritesheet_path = dir.join("spritesheet.webp");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;
    tokio::fs::write(&spritesheet_path, &bytes)
        .await
        .map_err(|e| format!("写入精灵图失败: {}", e))?;

    // 顺带拉 poster.webp（失败不阻断）。
    let mut poster_file: Option<String> = None;
    if let Some(poster_url) = detail.poster_url.as_ref() {
        if let Ok(poster_resp) = client.get(poster_url).send().await {
            if poster_resp.status().is_success() {
                if let Ok(poster_bytes) = poster_resp.bytes().await {
                    if !poster_bytes.is_empty() {
                        let poster_path = dir.join("poster.webp");
                        if tokio::fs::write(&poster_path, &poster_bytes)
                            .await
                            .is_ok()
                        {
                            poster_file = Some("poster.webp".to_string());
                        }
                    }
                }
            }
        }
    }

    let meta = LocalPetMeta {
        id: detail.id.clone(),
        display_name: detail.display_name.clone(),
        description: detail.description.clone(),
        kind: detail.kind.clone(),
        tags: detail.tags.clone(),
        source: "downloaded".to_string(),
        spritesheet_file: "spritesheet.webp".to_string(),
        poster_file,
        spritesheet_url: Some(spritesheet_url),
        version: detail
            .uploaded_at
            .as_ref()
            .and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok())
            .map(|dt| dt.timestamp_millis() as u64),
        installed_at: Some(now_rfc3339()),
    };
    write_meta(&dir, &meta)?;

    Ok(meta_to_info(&dir, &meta))
}

// --- 命令：本地宠物管理 --------------------------------------------------

/// 列出本地所有已安装的宠物（内置 + 下载）。
#[tauri::command]
pub fn list_local_pets(app: AppHandle) -> Result<Vec<LocalPetInfo>, String> {
    let root = pets_dir(&app)?;
    let mut infos: Vec<LocalPetInfo> = Vec::new();

    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Ok(infos),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(Some(meta)) = read_meta(&path) {
            // 缺精灵图的目录跳过（损坏或未完成）。
            if path.join(&meta.spritesheet_file).exists() {
                infos.push(meta_to_info(&path, &meta));
            }
        }
    }

    // 内置宠物排在最前，按 BUILTIN_PET_IDS 顺序稳定排序。
    infos.sort_by(|a, b| {
        let ai = BUILTIN_PET_IDS.iter().position(|id| *id == a.id);
        let bi = BUILTIN_PET_IDS.iter().position(|id| *id == b.id);
        match (ai, bi) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.id.cmp(&b.id),
        }
    });

    Ok(infos)
}

/// 删除本地宠物（内置删除后，下次启动会自动重装）。
#[tauri::command]
pub fn delete_local_pet(app: AppHandle, pet_id: String) -> Result<(), String> {
    let dir = pet_dir(&app, &pet_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除宠物目录失败: {}", e))?;
    }
    Ok(())
}

/// 返回某只宠物精灵图的绝对路径（前端用 convertFileSrc 转成可加载 URL）。
#[tauri::command]
pub fn get_pet_spritesheet_path(app: AppHandle, pet_id: String) -> Result<String, String> {
    let dir = pet_dir(&app, &pet_id)?;
    let meta = read_meta(&dir)?.ok_or_else(|| format!("宠物 {} 未安装", pet_id))?;
    let path = dir.join(&meta.spritesheet_file);
    if !path.exists() {
        return Err(format!("宠物 {} 的精灵图不存在", pet_id));
    }
    Ok(path.to_string_lossy().to_string())
}

/// 下载远程精灵图到临时缓存目录，返回本地绝对路径。
///
/// 用于宠物市场预览：前端因 CORS 无法直接 fetch codex-pets.net 的精灵图，
/// 通过 Rust 后端下载到 app_data/pets_cache/<pet_id>/spritesheet.webp，
/// 前端用 convertFileSrc 加载本地文件（无 CORS 限制）。
#[tauri::command]
pub async fn fetch_remote_spritesheet(
    app: AppHandle,
    pet_id: String,
    url: String,
) -> Result<String, String> {
    // 缓存目录：<app_data>/pets_cache/<pet_id>/spritesheet.webp
    let cache_root = get_app_data_dir(&app)?.join("pets_cache");
    let cache_dir = pet_cache_dir(&cache_root, &pet_id)?;

    let cached = cache_dir.join("spritesheet.webp");
    // 已缓存则直接返回（避免重复下载）。
    if cached.exists() {
        return Ok(cached.to_string_lossy().to_string());
    }

    // 下载。
    let client = http_client()?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(err_str)?
        .bytes()
        .await
        .map_err(err_str)?;

    if bytes.is_empty() {
        return Err("远程精灵图为空".to_string());
    }

    fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    fs::write(&cached, &bytes).map_err(|e| format!("写入缓存失败: {}", e))?;

    Ok(cached.to_string_lossy().to_string())
}

/// 缓存目录：<root>/<pet_id>（带路径穿越校验）。
fn pet_cache_dir(root: &Path, pet_id: &str) -> Result<PathBuf, String> {
    if !pet_id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("非法的宠物 id: {}", pet_id));
    }
    Ok(root.join(pet_id))
}

// --- 命令：内置宠物安装 --------------------------------------------------

/// 把 4 只内置宠物的资源从安装包复制到本地持久化目录（幂等，已存在则跳过）。
/// 在 lib.rs 的 setup 中调用一次，确保用户开箱即有可用宠物。
pub fn ensure_builtin_pets_installed(app: &AppHandle) -> Result<(), String> {
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|e| format!("获取 resource_dir 失败: {}", e))?
        .join("pets");

    for id in BUILTIN_PET_IDS {
        let src_dir = resource_root.join(id);
        let dest_dir = pet_dir(app, id)?;

        // 精灵图缺失才复制（已安装则保留用户可能修改的 meta）。
        let dest_sprite = dest_dir.join("spritesheet.webp");
        if !dest_sprite.exists() {
            let src_sprite = src_dir.join("spritesheet.webp");
            if !src_sprite.exists() {
                // 资源未找到（开发模式下 resources 可能尚未拷贝），跳过不报错。
                continue;
            }
            fs::create_dir_all(&dest_dir).map_err(|e| format!("创建目录失败: {}", e))?;
            fs::copy(&src_sprite, &dest_sprite)
                .map_err(|e| format!("复制内置精灵图失败: {}", e))?;
            // 顺带复制 poster（若有）。
            let src_poster = src_dir.join("poster.webp");
            if src_poster.exists() {
                let _ = fs::copy(&src_poster, dest_dir.join("poster.webp"));
            }
        }

        // meta.json：始终从安装包同步（保证 displayName/描述最新），并补 installed_at。
        let src_meta = src_dir.join("meta.json");
        if src_meta.exists() {
            if let Ok(content) = fs::read_to_string(&src_meta) {
                if let Ok(mut meta) = serde_json::from_str::<LocalPetMeta>(&content) {
                    if meta.installed_at.is_none() {
                        meta.installed_at = Some(now_rfc3339());
                    }
                    let _ = write_meta(&dest_dir, &meta);
                }
            }
        }
    }

    Ok(())
}

// --- 命令：宠物悬浮窗口 --------------------------------------------------

/// 确保宠物悬浮窗口存在（透明、无边框、置顶、跳过任务栏）。已存在则直接返回。
///
/// 启动时即调用一次创建隐藏窗口，保证 `emit_to("pet")` 监听始终存活——
/// 即便窗口处于隐藏态，前端监听器与事件通道依旧有效。
///
/// 注意：构建后**不立即**全屏定位。macOS 上 webview 尚未完成 URL 加载时，
/// 过早 `set_size` 会触发 Tauri runtime 查询 `WebView::url`（wry 内部 unwrap None）导致 panic。
/// 全屏定位推迟到 `show_pet_window`/`toggle_pet_window`（窗口即将可见时）执行。
pub fn ensure_pet_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, PET_WINDOW_LABEL, WebviewUrl::App("/pet".into()))
        .title("Desktop Pet")
        // 占位尺寸：show 时由 position_fullscreen 铺满当前显示器。
        .inner_size(800.0, 600.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("创建宠物窗口失败: {}", e))
}

/// 把宠物窗口定位到当前显示器右下角（考虑 Dock/任务栏预留边距）。
///
/// 优先取 `current_monitor()`（窗口当前所在屏），失败再回退 `primary_monitor()`，
/// 使宠物出现在用户当前关注的显示器而非永远是主屏。位置按显示器逻辑坐标（origin + size）
/// 钳制，保证窗口完全落在可见区域内（含边距），不溢出到屏幕外。
///
/// 全屏模式下 show/toggle 改用 `position_fullscreen`，此函数不再被调用，
/// 保留作为「右下角小窗模式」的备用定位能力。
#[allow(dead_code)]
fn position_bottom_right(window: &tauri::WebviewWindow) -> Result<(), String> {
    // current_monitor 在窗口首次创建/未定位时可能返回 None，此时回退主显示器。
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("获取当前显示器失败: {}", e))?
        .or_else(|| {
            window
                .primary_monitor()
                .map_err(|e| format!("获取主显示器失败: {}", e))
                .ok()
                .flatten()
        })
        .ok_or_else(|| "未找到可用显示器".to_string())?;

    let scale = monitor.scale_factor();
    // 显示器在虚拟桌面中的逻辑坐标原点（多屏时可能为负）。
    let mon_origin_x = monitor.position().x as f64 / scale;
    let mon_origin_y = monitor.position().y as f64 / scale;
    let mon_logical_w = monitor.size().width as f64 / scale;
    let mon_logical_h = monitor.size().height as f64 / scale;

    // 右下角目标位置（逻辑坐标，相对虚拟桌面原点）。
    let target_x = mon_origin_x + mon_logical_w - PET_WINDOW_WIDTH - PET_WINDOW_RIGHT_MARGIN;
    let target_y = mon_origin_y + mon_logical_h - PET_WINDOW_HEIGHT - PET_WINDOW_BOTTOM_MARGIN;

    // 钳制：窗口至少留 8px 在显示器可见区内（不溢出屏幕边缘）。
    let min_x = mon_origin_x + 8.0;
    let min_y = mon_origin_y + 8.0;
    let max_x = mon_origin_x + mon_logical_w - PET_WINDOW_WIDTH - 8.0;
    let max_y = mon_origin_y + mon_logical_h - PET_WINDOW_HEIGHT - 8.0;
    let x = target_x.clamp(min_x, max_x.max(min_x));
    let y = target_y.clamp(min_y, max_y.max(min_y));

    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("定位宠物窗口失败: {}", e))?;
    Ok(())
}

/// 把宠物窗口铺满当前显示器（全屏透明覆盖层）。
///
/// 宠物在全屏透明窗口内自由漫游（前端 viewport/click-through 已自适应窗口尺寸）。
/// 优先 `current_monitor`，失败回退 `primary_monitor`。窗口定位到显示器逻辑原点，
/// 尺寸设为显示器逻辑全尺寸（覆盖整屏，含 macOS 菜单栏区域——透明窗口不遮挡视线）。
fn position_fullscreen(window: &tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("获取当前显示器失败: {}", e))?
        .or_else(|| {
            window
                .primary_monitor()
                .map_err(|e| format!("获取主显示器失败: {}", e))
                .ok()
                .flatten()
        })
        .ok_or_else(|| "未找到可用显示器".to_string())?;

    let scale = monitor.scale_factor();
    let mon_origin_x = monitor.position().x as f64 / scale;
    let mon_origin_y = monitor.position().y as f64 / scale;
    let mon_logical_w = monitor.size().width as f64 / scale;
    let mon_logical_h = monitor.size().height as f64 / scale;

    // 定位到显示器逻辑原点，并按显示器逻辑尺寸铺满。
    window
        .set_position(LogicalPosition::new(mon_origin_x, mon_origin_y))
        .map_err(|e| format!("定位全屏宠物窗口失败: {}", e))?;
    window
        .set_size(LogicalSize::new(mon_logical_w, mon_logical_h))
        .map_err(|e| format!("设置全屏宠物窗口尺寸失败: {}", e))?;
    Ok(())
}

/// 多显示器包围盒并集（物理像素）。`Some((min_x, min_y, max_x, max_y))` 为并集矩形的
/// 左上角与右下角（物理像素，虚拟桌面坐标系）。所有显示器的物理矩形取最小/最大边界。
///
/// 抽出为纯函数（输入物理矩形元组列表）以便单测，不依赖 Tauri Monitor 类型。
fn monitors_union_physical(
    monitors: &[(f64, f64, f64, f64)], // (origin_x, origin_y, width, height) 物理像素
) -> Option<(f64, f64, f64, f64)> {
    if monitors.is_empty() {
        return None;
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for &(ox, oy, w, h) in monitors {
        if ox < min_x {
            min_x = ox;
        }
        if oy < min_y {
            min_y = oy;
        }
        let right = ox + w;
        let bottom = oy + h;
        if right > max_x {
            max_x = right;
        }
        if bottom > max_y {
            max_y = bottom;
        }
    }
    Some((min_x, min_y, max_x, max_y))
}

/// 把宠物窗口铺满所有显示器的并集（全屏透明覆盖层，跨屏漫游模式）。
///
/// 多屏时窗口覆盖整个虚拟桌面并集，前端 PixiJS 画布相应放大，宠物可跨屏穿行；
/// 前端按每块显示器的真实矩形做死区吸附，不规则布局下也不会让宠物消失。
/// 单屏 / 取不到显示器时委派 `position_fullscreen`（保持原有单屏行为）。
///
/// 用 Physical 坐标定位 + 设尺寸，避免跨屏不同 DPI 时的 scale 换算歧义
/// （窗口在 macOS 上为单一 scaleFactor；Windows 上跨不同 DPI 屏是已知 OS 限制）。
fn position_span_all_monitors(window: &tauri::WebviewWindow) -> Result<(), String> {
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("获取显示器列表失败: {}", e))?;

    // 单屏或无显示器 → 回退单屏铺满（与旧行为一致）。
    if monitors.len() <= 1 {
        return position_fullscreen(window);
    }

    // 收集所有显示器的物理矩形 (origin_x, origin_y, width, height)。
    let rects: Vec<(f64, f64, f64, f64)> = monitors
        .iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            (
                pos.x as f64,
                pos.y as f64,
                size.width as f64,
                size.height as f64,
            )
        })
        .collect();

    let (min_x, min_y, max_x, max_y) = monitors_union_physical(&rects)
        .ok_or_else(|| "无法计算显示器并集".to_string())?;

    let width = (max_x - min_x).max(1.0);
    let height = (max_y - min_y).max(1.0);

    // 定位到并集左上角（物理坐标），尺寸设为并集全尺寸（物理像素）。
    window
        .set_position(PhysicalPosition::new(min_x, min_y))
        .map_err(|e| format!("定位跨屏宠物窗口失败: {}", e))?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| format!("设置跨屏宠物窗口尺寸失败: {}", e))?;
    Ok(())
}

// --- 位置记忆 ------------------------------------------------------------

/// 宠物窗口位置持久化结构（逻辑坐标，与显示器虚拟桌面坐标系一致）。
#[derive(Serialize, Deserialize)]
struct PetWindowState {
    x: f64,
    y: f64,
}

/// 宠物窗口位置持久化文件：<app_data>/pet-window.json。
fn pet_window_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app)?.join("pet-window.json"))
}

/// 落盘宠物窗口位置（逻辑坐标）。
fn save_pet_window_position(app: &AppHandle, x: f64, y: f64) -> Result<(), String> {
    let path = pet_window_state_path(app)?;
    let content = serde_json::to_string_pretty(&PetWindowState { x, y })
        .map_err(|e| format!("序列化宠物窗口位置失败: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("写入宠物窗口位置失败: {}", e))?;
    Ok(())
}

/// 落盘宠物窗口位置的公开入口（供 lib.rs 的托盘切换助手调用）。
pub fn save_pet_window_position_pub(app: &AppHandle, x: f64, y: f64) -> Result<(), String> {
    save_pet_window_position(app, x, y)
}

/// 纯函数：判断窗口矩形 (x,y,w,h) 是否完全落在任一显示器矩形内。
///
/// `monitors` 每个元素为 `(origin_x, origin_y, width, height)`（逻辑坐标）。
/// 任一显示器完全包含窗口矩形即返回 true；显示器列表为空时返回 true（宽容策略，
/// 避免无法读取显示器信息时阻止恢复记忆位置）。抽出为纯函数以便单测。
///
/// 全屏模式下不再用于位置校验，保留作为带单测的纯工具函数。
#[allow(dead_code)]
fn rect_inside_any_monitor(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    monitors: &[(f64, f64, f64, f64)],
) -> bool {
    if monitors.is_empty() {
        return true;
    }
    let win_right = x + w;
    let win_bottom = y + h;
    monitors.iter().any(|(mx, my, mw, mh)| {
        let mon_right = mx + mw;
        let mon_bottom = my + mh;
        x >= *mx && y >= *my && win_right <= mon_right && win_bottom <= mon_bottom
    })
}

// --- 命令：宠物悬浮窗口 --------------------------------------------------

/// 显示宠物窗口。全屏透明窗口恒铺满当前显示器，宠物在内部自由漫游，无需位置记忆。
#[tauri::command]
pub fn show_pet_window(app: AppHandle) -> Result<(), String> {
    let window = ensure_pet_window(&app)?;
    // 跨屏漫游：窗口铺满所有显示器并集（单屏时自动回退单屏铺满）。
    position_span_all_monitors(&window)?;
    window.show().map_err(|e| format!("显示宠物窗口失败: {}", e))?;
    Ok(())
}

/// 隐藏宠物窗口。
///
/// 全屏模式下窗口位置恒定（恒铺满整屏），无需落盘记忆位置，直接隐藏即可。
#[tauri::command]
pub fn hide_pet_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) {
        window.hide().map_err(|e| format!("隐藏宠物窗口失败: {}", e))?;
    }
    Ok(())
}

/// 切换宠物窗口显隐，返回切换后是否可见。
///
/// 全屏透明窗口模式下位置恒定，显示时直接铺满整屏，隐藏时无需落盘记忆位置。
#[tauri::command]
pub fn toggle_pet_window(app: AppHandle) -> Result<bool, String> {
    let window = ensure_pet_window(&app)?;
    let visible = window.is_visible().map_err(|e| format!("{}", e))?;
    if visible {
        window.hide().map_err(|e| format!("隐藏宠物窗口失败: {}", e))?;
        Ok(false)
    } else {
        // 跨屏漫游：窗口铺满所有显示器并集（单屏时自动回退单屏铺满）。
        position_span_all_monitors(&window)?;
        window.show().map_err(|e| format!("显示宠物窗口失败: {}", e))?;
        Ok(true)
    }
}

/// 设置宠物窗口的置顶状态（运行时切换，对应设置里的"始终置顶"开关）。
#[tauri::command]
pub fn set_pet_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) {
        window
            .set_always_on_top(always_on_top)
            .map_err(|e| format!("切换置顶失败: {}", e))?;
    }
    Ok(())
}

// --- 命令：ZCode hook 联动（转调 crate::zcode 模块） ---------------------

/// 启用/禁用 ZCode shell hook 联动（注入/清理 ~/.zcode 配置）。
///
/// 薄转调：实际逻辑在 `crate::zcode` 模块（由其负责安装 hook 脚本、改写配置文件）。
#[tauri::command]
pub fn link_zcode(app: AppHandle, enabled: bool) -> Result<crate::zcode::LinkResult, String> {
    crate::zcode::set_zcode_linked(&app, enabled)
}

/// 查询当前是否已启用 ZCode 联动。
#[tauri::command]
pub fn get_zcode_link_status(app: AppHandle) -> Result<bool, String> {
    Ok(crate::zcode::is_zcode_linked(&app))
}

/// 检测系统是否安装了 Node.js（ZCode hook 联动依赖）。
///
/// hook 脚本以 `node <script>` 方式被 ZCode 拉起，若系统无 node 则联动静默失效。
/// 前端在开启联动前调用此命令，缺失时提示用户安装 Node.js。
/// 返回 node 版本号（如 "v20.11.0"）；不可用返回 Err。
#[tauri::command]
pub fn check_node_available() -> Result<String, String> {
    let output = std::process::Command::new("node")
        .arg("--version")
        .output()
        .map_err(|e| format!("未找到 Node.js：{}", e))?;
    if !output.status.success() {
        return Err("Node.js 不可用（node --version 执行失败）".to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err("无法读取 Node.js 版本".to_string());
    }
    Ok(version)
}

// --- 私有辅助 ------------------------------------------------------------

/// URL 路径段的安全编码：拒绝 ..、/，仅保留 pet id 合法字符。
fn urlencoding_path_segment(segment: &str) -> String {
    segment
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_segment_sanitizes_special_chars() {
        assert_eq!(urlencoding_path_segment("jige-kunkun"), "jige-kunkun");
        assert_eq!(urlencoding_path_segment("../x"), "___x");
    }

    #[test]
    fn rect_inside_monitor_when_fully_contained() {
        // 单显示器：原点 (0,0)，1920x1080。窗口 300x320 完全在内。
        let monitors = vec![(0.0, 0.0, 1920.0, 1080.0)];
        assert!(rect_inside_any_monitor(100.0, 100.0, 300.0, 320.0, &monitors));
        // 紧贴右下角（含）。
        assert!(rect_inside_any_monitor(1620.0, 760.0, 300.0, 320.0, &monitors));
    }

    #[test]
    fn rect_outside_when_partially_offscreen() {
        let monitors = vec![(0.0, 0.0, 1920.0, 1080.0)];
        // 右边溢出。
        assert!(!rect_inside_any_monitor(1700.0, 100.0, 300.0, 320.0, &monitors));
        // 下边溢出。
        assert!(!rect_inside_any_monitor(100.0, 900.0, 300.0, 320.0, &monitors));
        // 左上为负。
        assert!(!rect_inside_any_monitor(-10.0, 0.0, 300.0, 320.0, &monitors));
    }

    #[test]
    fn rect_inside_any_of_multiple_monitors() {
        // 双屏：主屏 (0,0) 1920x1080，副屏 (1920,0) 1920x1080。
        let monitors = vec![
            (0.0, 0.0, 1920.0, 1080.0),
            (1920.0, 0.0, 1920.0, 1080.0),
        ];
        // 落在副屏内。
        assert!(rect_inside_any_monitor(2000.0, 100.0, 300.0, 320.0, &monitors));
        // 横跨双屏（不在任一屏内）。
        assert!(!rect_inside_any_monitor(1800.0, 100.0, 300.0, 320.0, &monitors));
    }

    #[test]
    fn rect_empty_monitors_is_tolerant() {
        // 无法读取显示器时应宽容放行（不阻止恢复记忆位置）。
        assert!(rect_inside_any_monitor(100.0, 100.0, 300.0, 320.0, &[]));
    }

    #[test]
    fn union_single_monitor() {
        // 单屏 1920x1080 @ (0,0)。
        let monitors = vec![(0.0, 0.0, 1920.0, 1080.0)];
        let (min_x, min_y, max_x, max_y) = monitors_union_physical(&monitors).unwrap();
        assert_eq!((min_x, min_y), (0.0, 0.0));
        assert_eq!((max_x, max_y), (1920.0, 1080.0));
    }

    #[test]
    fn union_two_monitors_side_by_side() {
        // 双屏并排：主屏 (0,0) 1920x1080，副屏 (1920,0) 1920x1080。
        let monitors = vec![
            (0.0, 0.0, 1920.0, 1080.0),
            (1920.0, 0.0, 1920.0, 1080.0),
        ];
        let (min_x, min_y, max_x, max_y) = monitors_union_physical(&monitors).unwrap();
        assert_eq!((min_x, min_y), (0.0, 0.0));
        assert_eq!((max_x, max_y), (3840.0, 1080.0));
    }

    #[test]
    fn union_negative_origin_monitor() {
        // 副屏在主屏左侧（负坐标原点）：主屏 (0,0)，副屏 (-1920,0) 1920x1080。
        let monitors = vec![
            (0.0, 0.0, 1920.0, 1080.0),
            (-1920.0, 0.0, 1920.0, 1080.0),
        ];
        let (min_x, min_y, max_x, max_y) = monitors_union_physical(&monitors).unwrap();
        assert_eq!((min_x, min_y), (-1920.0, 0.0));
        assert_eq!((max_x, max_y), (1920.0, 1080.0));
    }

    #[test]
    fn union_l_shaped_different_heights() {
        // L 形布局：主屏 (0,0) 1920x1080，副屏 (1920, -360) 1920x1440（副屏更高且偏上）。
        // 并集会有死区（主屏右侧 x∈(1920,3840) 且 y>720 区域无屏），但并集本身应覆盖全部范围。
        let monitors = vec![
            (0.0, 0.0, 1920.0, 1080.0),
            (1920.0, -360.0, 1920.0, 1440.0),
        ];
        let (min_x, min_y, max_x, max_y) = monitors_union_physical(&monitors).unwrap();
        assert_eq!((min_x, min_y), (0.0, -360.0));
        assert_eq!((max_x, max_y), (3840.0, 1080.0));
    }

    #[test]
    fn union_empty_returns_none() {
        assert!(monitors_union_physical(&[]).is_none());
    }
}
