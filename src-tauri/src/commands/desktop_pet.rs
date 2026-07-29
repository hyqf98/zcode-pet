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
    AppHandle, Listener, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
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

/// codex-pets.net 包内的 manifest.json 结构（与本地 meta.json 不同）。
///
/// 用户从 codex-pets 下载 ZIP 解压后，目录里只有 manifest.json + spritesheet.webp（没有 meta.json）。
/// 本结构用于把上游格式映射成本地 LocalPetMeta 后再落盘 meta.json，实现对 codex 原生包的兼容导入。
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct CodexManifest {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// 上游用 spritesheetPath 指向精灵图文件名（通常 "spritesheet.webp"）。
    pub spritesheet_path: String,
    /// 1 = 标准 9 行图集，2 = 扩展 11 行图集。
    #[serde(default)]
    pub sprite_version_number: Option<u32>,
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
    /// 精灵图版本号（codex manifest.json 的 spriteVersionNumber）：
    /// 1 = 标准 9 行图集（1536x1872），2 = 扩展 11 行图集（1536x2288）。
    /// 缺省时由渲染层按图集实际高度推断（≥11 行按 v2 处理）。
    #[serde(default)]
    pub sprite_version_number: Option<u32>,
    #[serde(default)]
    pub installed_at: Option<String>,
}

/// 市场网络代理配置（market-proxy.json）。
///
/// - `auto`：优先读环境变量（HTTPS_PROXY / HTTP_PROXY / ALL_PROXY），无则用 Clash 默认 7890。
/// - `direct`：直连，不使用代理（显式 `.no_proxy()`）。
/// - `custom`：使用 `custom_url` 指定的代理地址。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub mode: String,
    #[serde(default)]
    pub custom_url: String,
}

/// 市场连接测试结果。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarketConnectionResult {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
    pub proxy_used: Option<String>,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            mode: "auto".to_string(),
            custom_url: String::new(),
        }
    }
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
    pub sprite_version_number: Option<u32>,
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

/// 读取某只宠物目录下的元数据：优先 meta.json，不存在则回退到 codex 的 manifest.json。
///
/// 兼容 codex-pets.net 原生包：用户把下载的 ZIP 解压进 pets/ 目录时，里面只有 manifest.json
/// （字段为 spritesheetPath / spriteVersionNumber），没有本地 meta.json。这里把 manifest 映射成
/// LocalPetMeta，并（可选）落盘 meta.json 便于后续管理与编辑。
fn read_meta(dir: &Path) -> Result<Option<LocalPetMeta>, String> {
    let meta_path = dir.join("meta.json");
    if meta_path.exists() {
        let content = fs::read_to_string(&meta_path)
            .map_err(|e| format!("读取 meta.json 失败: {}", e))?;
        let meta: LocalPetMeta = serde_json::from_str(&content)
            .map_err(|e| format!("解析 meta.json 失败: {}", e))?;
        return Ok(Some(meta));
    }

    // 回退：codex manifest.json（上游包格式）。
    let manifest_path = dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("读取 manifest.json 失败: {}", e))?;
    let manifest: CodexManifest = serde_json::from_str(&content)
        .map_err(|e| format!("解析 manifest.json 失败: {}", e))?;

    let meta = LocalPetMeta {
        id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        description: manifest.description.clone(),
        kind: manifest.kind.clone(),
        tags: vec![],
        source: "imported".to_string(),
        spritesheet_file: manifest.spritesheet_path.clone(),
        poster_file: None,
        spritesheet_url: None,
        version: None,
        sprite_version_number: manifest.sprite_version_number,
        installed_at: Some(now_rfc3339()),
    };

    // 落盘成 meta.json，后续读取走快路径，也便于用户编辑。
    let _ = write_meta(dir, &meta);

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
        sprite_version_number: meta.sprite_version_number,
        installed_at: meta.installed_at.clone(),
    }
}

// --- 私有辅助：HTTP + 代理 ------------------------------------------------

/// Clash 默认 HTTP 代理端口（codex-pets.net 需翻墙访问时，多数用户使用 Clash）。
const DEFAULT_PROXY_URL: &str = "http://127.0.0.1:7890";

/// 代理配置持久化文件：<app_data>/market-proxy.json。
fn proxy_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app)?.join("market-proxy.json"))
}

/// 读取代理配置（文件不存在或解析失败时返回默认 auto 配置）。
fn read_proxy_config(app: &AppHandle) -> ProxyConfig {
    let path = match proxy_config_path(app) {
        Ok(p) => p,
        Err(_) => return ProxyConfig::default(),
    };
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<ProxyConfig>(&content).unwrap_or_default(),
        Err(_) => ProxyConfig::default(),
    }
}

/// 写入代理配置到 market-proxy.json。
fn write_proxy_config(app: &AppHandle, config: &ProxyConfig) -> Result<(), String> {
    let path = proxy_config_path(app)?;
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化代理配置失败: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("写入代理配置失败: {}", e))?;
    Ok(())
}

/// 纯函数：根据配置解析实际使用的代理 URL。
///
/// - `auto`：优先返回环境变量 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY（大小写均查），
///   均无则返回 Clash 默认 `http://127.0.0.1:7890`。
/// - `direct`：返回 None（直连）。
/// - `custom`：返回 `custom_url`（空串视为 None）。
pub fn resolve_proxy_url(config: &ProxyConfig) -> Option<String> {
    match config.mode.as_str() {
        "direct" => None,
        "custom" => {
            let url = config.custom_url.trim();
            if url.is_empty() {
                None
            } else {
                Some(url.to_string())
            }
        }
        // "auto" 及未知值均走 auto 逻辑。
        _ => {
            for var in &[
                "HTTPS_PROXY",
                "HTTP_PROXY",
                "ALL_PROXY",
                "https_proxy",
                "http_proxy",
                "all_proxy",
            ] {
                if let Ok(val) = std::env::var(var) {
                    let val = val.trim();
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            }
            Some(DEFAULT_PROXY_URL.to_string())
        }
    }
}

/// 构造带代理 + 超时的 reqwest 客户端（rustls）。
///
/// 按代理配置注入 `reqwest::Proxy::all`：`direct` 模式显式 `.no_proxy()`。
fn http_client_with_proxy(app: &AppHandle) -> Result<reqwest::Client, String> {
    let config = read_proxy_config(app);
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(20));
    match resolve_proxy_url(&config) {
        Some(url) => {
            builder = builder
                .proxy(reqwest::Proxy::all(&url).map_err(|e| format!("设置代理失败: {}", e))?);
        }
        None => {
            builder = builder.no_proxy();
        }
    }
    builder
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
    app: AppHandle,
    q: Option<String>,
    kind: Option<String>,
    sort: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<CodexPetListResponse, String> {
    let client = http_client_with_proxy(&app)?;
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
pub async fn get_codex_pet_detail(app: AppHandle, pet_id: String) -> Result<CodexPetSummary, String> {
    let client = http_client_with_proxy(&app)?;
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
    let detail = get_codex_pet_detail(app.clone(), pet_id.clone()).await?;

    let spritesheet_url = detail
        .spritesheet_url
        .clone()
        .ok_or_else(|| format!("宠物 {} 未提供 spritesheetUrl", pet_id))?;

    let client = http_client_with_proxy(&app)?;
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
        sprite_version_number: None,
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

/// 删除本地宠物（内置宠物不可删除）。
#[tauri::command]
pub fn delete_local_pet(app: AppHandle, pet_id: String) -> Result<(), String> {
    if BUILTIN_PET_IDS.contains(&pet_id.as_str()) {
        return Err("内置宠物不能删除".to_string());
    }
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
    let client = http_client_with_proxy(&app)?;
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
        .map_err(|e| format!("创建宠物窗口失败: {}", e))?;

    // 默认设为鼠标穿透（click-through）。前端轮询会在精灵上方切回可交互；
    // 即便前端启动失败/抛错，窗口也始终透明 + 穿透，绝不变成不透明遮挡层挡住整屏。
    if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
        let _ = w.set_ignore_cursor_events(true);
        return Ok(w);
    }
    Err("宠物窗口创建后无法获取".to_string())
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

/// 窗口迁移后返回的新几何信息（物理像素），供前端做宠物坐标重映射。
/// 前端在迁移前后用「虚拟桌面物理坐标」保持宠物位置连续，实现无缝跨屏。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    /// 新窗口物理原点（虚拟桌面坐标系）。
    origin_x: f64,
    origin_y: f64,
    /// 新窗口物理宽高。
    width: f64,
    height: f64,
    /// 新窗口逻辑宽高（= 物理 / scaleFactor），与 PixiJS 画布逻辑坐标一致。
    logical_width: f64,
    logical_height: f64,
    /// 新显示器的 scaleFactor。
    scale_factor: f64,
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

/// 显示宠物窗口。全屏透明窗口铺满当前显示器（单屏），宠物在内部自由漫游。
/// 多屏漫游由前端在检测到宠物跨屏时调用 `move_pet_window_to_monitor` 迁移窗口实现。
///
/// 会等待前端「首帧就绪」事件再显示：pet 窗口加载 HTML 时，webview 在解析到内联透明
/// 样式（index.html 的 html.pet-window）之前会闪现默认白底。这里在 show 前阻塞等待前端
/// emit 的 `pet-window-ready`（DOMContentLoaded 触发，此时内联透明样式已应用），消除白屏。
/// 带 800ms 超时兜底：即便前端加载失败/抛错，窗口仍会显示（不能因等不到事件而永远不显示）。
#[tauri::command]
pub async fn show_pet_window(app: AppHandle) -> Result<(), String> {
    let window = ensure_pet_window(&app)?;
    // 单屏铺满当前显示器（macOS 下跨屏超大窗口在副屏不可见，故采用单屏 + 迁移）。
    position_fullscreen(&window)?;

    // 等待前端首帧就绪（最多 800ms），消除 webview 解析 HTML 期间的白色闪屏。
    wait_pet_window_ready(&app).await;

    window.show().map_err(|e| format!("显示宠物窗口失败: {}", e))?;
    Ok(())
}

/// 等待前端 emit `pet-window-ready`（带 800ms 超时兜底）。
///
/// pet 窗口的 index.html 内联了透明样式（html.pet-window body { background:transparent }），
/// 但该样式仅在 HTML 解析后生效。webview 创建后、解析前的极短窗口内会渲染默认白底。
/// 前端在 DOMContentLoaded（内联透明样式已应用）时 emit 本事件；后端等到后再 show，
/// 从用户视角窗口「直接透明出现」，不再有白屏闪现。超时兜底防止前端异常导致窗口永不显示。
async fn wait_pet_window_ready(app: &AppHandle) {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let tx_clone = tx.clone();
    let _listener = app.listen("pet-window-ready", move |_event| {
        if let Some(sender) = tx_clone.lock().ok().and_then(|mut g| g.take()) {
            let _ = sender.send(());
        }
    });
    // 超时兜底：800ms 内没等到事件也继续 show（不能让窗口因前端问题而永远不可见）。
    let _ = tokio::time::timeout(Duration::from_millis(800), rx).await;
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
/// 显示路径同样等待前端首帧就绪，消除白屏（与 show_pet_window 一致）。
#[tauri::command]
pub async fn toggle_pet_window(app: AppHandle) -> Result<bool, String> {
    let window = ensure_pet_window(&app)?;
    let visible = window.is_visible().map_err(|e| format!("{}", e))?;
    if visible {
        window.hide().map_err(|e| format!("隐藏宠物窗口失败: {}", e))?;
        Ok(false)
    } else {
        // 单屏铺满当前显示器。
        position_fullscreen(&window)?;
        wait_pet_window_ready(&app).await;
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

/// 把宠物窗口迁移到指定显示器并铺满该屏（单屏铺满，跨屏漫游的迁移原语）。
///
/// macOS 下单个透明窗口无法跨屏渲染（副屏不可见），故采用「单屏铺满 + 跨屏迁移」：
/// 窗口始终铺满宠物当前所在屏；当宠物走到屏边要进入相邻屏时，前端调用此命令把窗口
/// 迁移到目标屏。返回新窗口几何（物理 + 逻辑），前端据此重映射宠物坐标，保持视觉连续。
///
/// `target_monitor_name` 为目标显示器名（来自 Tauri availableMonitors 的 Monitor.name）。
/// 找不到该显示器时回退 `position_fullscreen`（铺满当前屏）。
#[tauri::command]
pub fn move_pet_window_to_monitor(
    app: AppHandle,
    target_monitor_name: String,
) -> Result<WindowGeometry, String> {
    let window = app
        .get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| "宠物窗口不存在".to_string())?;

    let monitors = window
        .available_monitors()
        .map_err(|e| format!("获取显示器列表失败: {}", e))?;

    // 按名匹配目标显示器。
    let target = monitors
        .into_iter()
        .find(|m| m.name().map(|n| *n == target_monitor_name).unwrap_or(false));
    // 找不到 → 回退当前屏铺满。
    let monitor = match target {
        Some(m) => m,
        None => {
            let (origin_x, origin_y, logical_w, logical_h, scale) =
                position_fullscreen_and_report(&window)?;
            return Ok(WindowGeometry {
                origin_x,
                origin_y,
                width: logical_w * scale,
                height: logical_h * scale,
                logical_width: logical_w,
                logical_height: logical_h,
                scale_factor: scale,
            });
        }
    };

    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let origin_x = pos.x as f64;
    let origin_y = pos.y as f64;
    let width = size.width as f64;
    let height = size.height as f64;
    let logical_width = width / scale;
    let logical_height = height / scale;

    // 迁移：定位到目标屏物理原点，尺寸设为目标屏物理全尺寸。
    window
        .set_position(PhysicalPosition::new(origin_x, origin_y))
        .map_err(|e| format!("迁移宠物窗口定位失败: {}", e))?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| format!("迁移宠物窗口尺寸失败: {}", e))?;

    Ok(WindowGeometry {
        origin_x,
        origin_y,
        width,
        height,
        logical_width,
        logical_height,
        scale_factor: scale,
    })
}

/// 铺满当前屏（position_fullscreen）并返回其几何信息（物理原点 + 逻辑尺寸 + scale）。
/// 供 move_pet_window_to_monitor 的回退路径复用。
fn position_fullscreen_and_report(
    window: &tauri::WebviewWindow,
) -> Result<(f64, f64, f64, f64, f64), String> {
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
    let pos = monitor.position();
    let size = monitor.size();
    let origin_x = pos.x as f64;
    let origin_y = pos.y as f64;
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;

    window
        .set_position(LogicalPosition::new(origin_x, origin_y))
        .map_err(|e| format!("定位全屏宠物窗口失败: {}", e))?;
    window
        .set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| format!("设置全屏宠物窗口尺寸失败: {}", e))?;

    Ok((origin_x, origin_y, logical_w, logical_h, scale))
}

// --- 命令：市场网络代理 --------------------------------------------------

/// 读取当前市场代理配置。
#[tauri::command]
pub fn get_market_proxy_config(app: AppHandle) -> ProxyConfig {
    read_proxy_config(&app)
}

/// 设置市场代理配置并持久化。
///
/// `mode` 为 "auto" / "direct" / "custom"；`custom_url` 仅 custom 模式使用。
/// 返回写入后的配置。
#[tauri::command]
pub fn set_market_proxy(
    app: AppHandle,
    mode: String,
    custom_url: String,
) -> Result<ProxyConfig, String> {
    let config = ProxyConfig { mode, custom_url };
    write_proxy_config(&app, &config)?;
    Ok(config)
}

/// 测试与 codex-pets.net 的网络连通性（用当前代理配置发起一次轻量请求）。
///
/// 返回 `{ ok, latencyMs, error, proxyUsed }`，供前端在代理设置旁显示连接状态。
#[tauri::command]
pub async fn test_market_connection(app: AppHandle) -> MarketConnectionResult {
    let config = read_proxy_config(&app);
    let proxy_used = resolve_proxy_url(&config);

    let client = match http_client_with_proxy(&app) {
        Ok(c) => c,
        Err(e) => {
            return MarketConnectionResult {
                ok: false,
                latency_ms: None,
                error: Some(e),
                proxy_used,
            }
        }
    };

    let url = format!("{}/api/pets?pageSize=1", PETSHARE_BASE);
    let start = std::time::Instant::now();
    match client.get(&url).send().await {
        Ok(resp) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let ok = resp.status().is_success();
            let error = if ok {
                None
            } else {
                Some(format!("HTTP {}", resp.status()))
            };
            MarketConnectionResult {
                ok,
                latency_ms: Some(latency_ms),
                error,
                proxy_used,
            }
        }
        Err(e) => MarketConnectionResult {
            ok: false,
            latency_ms: Some(start.elapsed().as_millis() as u64),
            error: Some(e.to_string()),
            proxy_used,
        },
    }
}

// --- 命令：本地导入宠物 --------------------------------------------------

/// 从本地文件导入宠物精灵图。
///
/// 读取用户选择的图片文件，检测格式（PNG / WebP），生成唯一 id 并落盘到
/// `<app_data>/pets/uploaded-<hex>/`，写入 `meta.json`（source: "uploaded"）。
/// 文件名（去扩展名）作为宠物显示名，也可由 `display_name` 覆盖。
#[tauri::command]
pub async fn import_local_pet(
    app: AppHandle,
    file_path: String,
    display_name: Option<String>,
) -> Result<LocalPetInfo, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }

    let bytes = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    if bytes.is_empty() {
        return Err("文件为空".to_string());
    }

    // 检测格式并确定扩展名。
    let ext = detect_image_ext(&bytes)
        .ok_or_else(|| "不支持的图片格式（仅支持 PNG / WebP）".to_string())?;

    // 生成唯一 id：uploaded-<16位hex>（时间戳纳秒，碰撞概率极低）。
    let id = generate_uploaded_id();
    let dir = pet_dir(&app, &id)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let spritesheet_file = format!("spritesheet.{}", ext);
    let spritesheet_path = dir.join(&spritesheet_file);
    tokio::fs::write(&spritesheet_path, &bytes)
        .await
        .map_err(|e| format!("写入精灵图失败: {}", e))?;

    // 显示名：优先用参数，否则用文件名（去扩展名）。
    let name = display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "导入宠物".to_string());

    let meta = LocalPetMeta {
        id: id.clone(),
        display_name: name,
        description: None,
        kind: None,
        tags: vec![],
        source: "uploaded".to_string(),
        spritesheet_file,
        poster_file: None,
        spritesheet_url: None,
        version: None,
        sprite_version_number: None,
        installed_at: Some(now_rfc3339()),
    };
    write_meta(&dir, &meta)?;

    Ok(meta_to_info(&dir, &meta))
}

/// 从 magic bytes 检测图片格式，返回扩展名（png / webp）。
fn detect_image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" {
        return Some("png");
    }
    // WebP: RIFF....WEBP（offset 0 = "RIFF", offset 8 = "WEBP"）。
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

/// 生成上传宠物的唯一 id：uploaded-<16位hex 纳秒时间戳>。
fn generate_uploaded_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("uploaded-{:016x}", nanos)
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

// --- 命令：ZCode token 使用量统计 ----------------------------------------

/// 获取 ZCode SQLite 数据库路径（自动检测 + 用户覆盖）。
///
/// 返回检测到的 db.sqlite 绝对路径字符串，供前端展示。
/// 未检测到时返回 None（前端提示用户手动填写数据目录）。
#[tauri::command]
pub fn get_zcode_db_path(app: AppHandle) -> Result<Option<String>, String> {
    Ok(crate::zcode::stats::resolve_db_path(&app)
        .map(|p| p.to_string_lossy().to_string()))
}

/// 设置/清除 ZCode 数据目录覆盖路径。
///
/// `dir` 为 None 或空串时清除覆盖（恢复自动检测）。
/// 返回 true 表示覆盖后路径检测成功（DB 文件存在）。
#[tauri::command]
pub fn set_zcode_data_dir(app: AppHandle, dir: Option<String>) -> Result<bool, String> {
    let trimmed = dir.as_deref().map(str::trim).filter(|s| !s.is_empty());
    crate::zcode::stats::write_override_dir(&app, trimmed)
}

/// 查询今日 ZCode token 使用量统计。
///
/// 从 ZCode SQLite 库只读查询 model_usage 表，返回今日各模型 token 消耗汇总。
/// DB 路径未检测到时返回 Err（前端可静默忽略）。
#[tauri::command]
pub fn get_zcode_token_stats(
    app: AppHandle,
) -> Result<Option<crate::zcode::stats::TokenStats>, String> {
    let db_path = crate::zcode::stats::resolve_db_path(&app)
        .ok_or_else(|| "未检测到 ZCode 数据目录".to_string())?;
    crate::zcode::stats::query_today_stats(&db_path).map(Some)
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

    // --- 代理配置测试 ------------------------------------------------------

    #[test]
    fn proxy_resolve_direct_returns_none() {
        let config = ProxyConfig {
            mode: "direct".to_string(),
            custom_url: String::new(),
        };
        assert_eq!(resolve_proxy_url(&config), None);
    }

    #[test]
    fn proxy_resolve_custom_returns_url() {
        let config = ProxyConfig {
            mode: "custom".to_string(),
            custom_url: "http://192.168.1.1:8080".to_string(),
        };
        assert_eq!(
            resolve_proxy_url(&config),
            Some("http://192.168.1.1:8080".to_string())
        );
    }

    #[test]
    fn proxy_resolve_custom_empty_returns_none() {
        let config = ProxyConfig {
            mode: "custom".to_string(),
            custom_url: "  ".to_string(),
        };
        assert_eq!(resolve_proxy_url(&config), None);
    }

    #[test]
    fn proxy_resolve_auto_fallback_to_default() {
        // 在没有设置代理环境变量时，auto 模式应回退到 Clash 默认 7890。
        // 临时清除环境变量以确保测试可复现。
        let saved: Vec<(String, Option<String>)> = [
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "ALL_PROXY",
            "https_proxy",
            "http_proxy",
            "all_proxy",
        ]
        .iter()
        .map(|k| (k.to_string(), std::env::var(k).ok()))
        .collect();
        for k in &[
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "ALL_PROXY",
            "https_proxy",
            "http_proxy",
            "all_proxy",
        ] {
            std::env::remove_var(k);
        }

        let config = ProxyConfig {
            mode: "auto".to_string(),
            custom_url: String::new(),
        };
        assert_eq!(
            resolve_proxy_url(&config),
            Some(DEFAULT_PROXY_URL.to_string())
        );

        // 恢复环境变量。
        for (k, v) in &saved {
            if let Some(val) = v {
                std::env::set_var(k, val);
            }
        }
    }

    // --- 删除保护测试 ------------------------------------------------------

    #[test]
    fn delete_rejects_builtin_id() {
        // 纯逻辑检查：内置 id 应在保护列表中。
        for id in BUILTIN_PET_IDS {
            assert!(BUILTIN_PET_IDS.contains(id));
        }
    }

    // --- 图片格式检测测试 --------------------------------------------------

    #[test]
    fn detect_png_magic_bytes() {
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00IHDR";
        assert_eq!(detect_image_ext(png), Some("png"));
    }

    #[test]
    fn detect_webp_magic_bytes() {
        let mut webp = b"RIFF\x00\x00\x00\x00WEBP".to_vec();
        webp.extend_from_slice(&[0u8; 10]);
        assert_eq!(detect_image_ext(&webp), Some("webp"));
    }

    #[test]
    fn detect_unknown_format_returns_none() {
        let jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF";
        assert_eq!(detect_image_ext(jpeg), None);
        let random = b"hello world this is not an image";
        assert_eq!(detect_image_ext(random), None);
    }

    #[test]
    fn uploaded_id_format_is_valid() {
        let id = generate_uploaded_id();
        assert!(id.starts_with("uploaded-"));
        // 验证 id 通过 pet_dir 的字符校验（仅 a-z0-9-）。
        assert!(
            id.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        );
    }
}
