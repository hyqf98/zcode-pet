// ZCode Pet 应用入口。
//
// 职责：
// - setup：安装内置宠物 → 安装 ZCode hook 脚本 → 启动本地 hook HTTP 服务 →
//   预创建隐藏宠物窗口（保证 emit_to("pet") 监听始终存活）。
// - 系统托盘：显示/隐藏宠物、打开管理窗口、始终置顶、退出。
// - 窗口关闭行为：pet 窗与 main 窗均「最小化到托盘」而非退出应用。
// - invoke_handler：注册全部桌面宠物命令（市场搜索/下载/本地管理/窗口控制/ZCode 联动）。
//
// 遵循 tauri-harness 后端规范：命令层薄入口，业务逻辑在 commands/desktop_pet.rs。

mod commands;
mod error;
mod zcode;

use commands::desktop_pet::{self, PET_WINDOW_LABEL};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

/// 日志辅助：启动阶段错误输出。
fn log_bootstrap_error(stage: &str, msg: &str) {
    tracing::error!("[{}] {}", stage, msg);
}

/// 托盘菜单运行时状态：始终置顶原子值 + CheckMenuItem 句柄。
///
/// 后端读不到前端 localStorage，「始终置顶」初始默认 true。点击时翻转原子值，
/// 通过存储的 CheckMenuItem 句柄同步勾选显示，再 set_always_on_top 生效。
/// （TrayIcon 没有 menu getter，故把菜单项句柄本身存进 managed state。）
struct TrayState {
    always_on_top: AtomicBool,
    /// 泛型 R 显式为 Wry：菜单项由默认 Runtime（Wry）的 App 创建，存进 managed state 需显式标注。
    always_on_top_item: CheckMenuItem<tauri::Wry>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志。
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init());

    // MCP Bridge：仅 debug 构建启用，供 Tauri MCP 端到端测试（release 自动排除）。
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            // 1. 安装内置桌面宠物资源（幂等：缺则从安装包复制，已存在则跳过）。
            if let Err(e) = desktop_pet::ensure_builtin_pets_installed(app.handle()) {
                log_bootstrap_error(
                    "DesktopPet",
                    &format!("Failed to install builtin pets: {}", e),
                );
            }

            // 2. 安装 ZCode hook 脚本到 app_data（失败仅日志，不阻断启动）。
            if let Err(e) = zcode::ensure_hook_script_installed(app.handle()) {
                log_bootstrap_error(
                    "ZCodeHook",
                    &format!("Failed to install hook script: {}", e),
                );
            }

            // 3. 启动本地 hook HTTP 服务（非阻塞，内部 tokio::spawn）。
            zcode::start_hook_server(app.handle().clone());

            // 4. 预创建隐藏的宠物窗口，确保 emit_to("pet") 监听始终存活
            //    （即便窗口隐藏，前端监听器与事件通道依旧有效）。
            if let Err(e) = desktop_pet::ensure_pet_window(app.handle()) {
                log_bootstrap_error(
                    "DesktopPet",
                    &format!("Failed to ensure pet window: {}", e),
                );
            }

            // 5. 构建系统托盘。
            setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // pet 窗与 main 窗均「最小化到托盘」：阻止真正关闭，改为隐藏。
            // 这样关掉任一可见窗口都不会退出应用，进程驻留托盘直至用户点击退出。
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    "pet" | "main" => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // codex-pets.net 市场
            desktop_pet::search_codex_pets,
            desktop_pet::get_codex_pet_detail,
            desktop_pet::download_codex_pet,
            // 本地宠物管理
            desktop_pet::list_local_pets,
            desktop_pet::delete_local_pet,
            desktop_pet::get_pet_spritesheet_path,
            desktop_pet::fetch_remote_spritesheet,
            // 宠物悬浮窗口控制
            desktop_pet::show_pet_window,
            desktop_pet::hide_pet_window,
            desktop_pet::toggle_pet_window,
            desktop_pet::set_pet_always_on_top,
            // ZCode hook 联动
            desktop_pet::link_zcode,
            desktop_pet::get_zcode_link_status,
            desktop_pet::check_node_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zcode_pet application");
}

/// 构建系统托盘（图标 + 菜单 + 事件处理）。
///
/// 菜单项：显示/隐藏宠物、打开管理窗口、始终置顶（勾选项）、分隔线、退出。
/// 托盘图标用打包默认窗口图标（`default_window_icon`），tooltip「ZCode 桌面宠物」。
/// 左键单击托盘图标 = 切换宠物窗口显隐。
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_pet =
        MenuItem::with_id(app, "toggle-pet", "显示/隐藏宠物", true, None::<&str>)?;
    let open_manager =
        MenuItem::with_id(app, "open-manager", "打开管理窗口", true, None::<&str>)?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        "always-on-top",
        "始终置顶",
        true,
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        // Tauri 2.11.5：with_items 第二参数为菜单项切片（各 item 实现 IsMenuItem<Wry>）。
        &[&toggle_pet, &open_manager, &always_on_top, &separator, &quit],
    )?;

    // 把菜单项句柄存进 managed state，供菜单事件处理器同步勾选状态。
    // （TrayIcon 没有 menu getter；CheckMenuItem 是引用计数句柄，可安全 Clone。）
    app.manage(TrayState {
        always_on_top: AtomicBool::new(true),
        always_on_top_item: always_on_top.clone(),
    });

    let icon = app.default_window_icon().cloned();

    // Tauri 2.11.5：TrayIconBuilder::with_id 只收 id（泛型 R 在 build 时由 manager 推断）；
    // icon 接收 Image<'_> 而非 Option，故先建 builder 再按需挂图标。
    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("ZCode 桌面宠物")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_tray_menu_event)
        .on_tray_icon_event(|tray, event| {
            // 左键单击切换宠物窗口显隐。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_pet_visibility(app);
            }
        });
    if let Some(img) = icon {
        tray_builder = tray_builder.icon(img);
    }
    tray_builder.build(app)?;

    Ok(())
}

/// 处理托盘菜单点击事件。
fn handle_tray_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "toggle-pet" => toggle_pet_visibility(app),
        "open-manager" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            // 通知前端打开设置页（前端可监听此事件跳转到宠物设置 tab）。
            let _ = app.emit("desktop-pet:open-settings", ());
        }
        "always-on-top" => {
            // 翻转原子状态 → 同步菜单勾选 → 应用到宠物窗口。
            let state = app.state::<TrayState>();
            let next = !state.always_on_top.load(Ordering::SeqCst);
            state.always_on_top.store(next, Ordering::SeqCst);
            let _ = state.always_on_top_item.set_checked(next);

            if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
                let _ = w.set_always_on_top(next);
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

/// 切换宠物窗口显隐（供托盘左键单击与「显示/隐藏宠物」菜单项共用）。
///
/// 在 Rust 侧直接操作窗口，不经过 invoke：可见则隐藏（隐藏前落盘位置），
/// 不可见则复用 show_pet_window 的位置恢复逻辑。
fn toggle_pet_visibility(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PET_WINDOW_LABEL) {
        let visible = w.is_visible().unwrap_or(false);
        if visible {
            if let (Ok(pos), Ok(scale)) = (w.outer_position(), w.scale_factor()) {
                if scale > 0.0 {
                    let _ = desktop_pet::save_pet_window_position_pub(
                        app,
                        pos.x as f64 / scale,
                        pos.y as f64 / scale,
                    );
                }
            }
            let _ = w.hide();
        } else {
            let _ = desktop_pet::show_pet_window(app.clone());
        }
    }
}
