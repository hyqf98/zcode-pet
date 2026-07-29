//! ZCode 联动模块：接收 ZCode hook 事件并转发给桌面宠物窗口。
//!
//! 整体架构：
//! 1. [`hook_server`] 在应用启动时拉起一个监听 `127.0.0.1`（随机端口）的本地 HTTP 服务，
//!    并把端口号写入 `<app_data>/zcode-pet.port`。
//! 2. ZCode 的 hook（一次性子进程）由 [`link`] 注入到 `~/.zcode/cli/config.json`，
//!    指向本应用安装的纯转发脚本（`zcode-pet-hook.mjs`）。
//! 3. 该脚本读取 stdin 原文，POST 到上述本地服务的 `/hook`。
//! 4. 服务收到后解析为 [`models::ZCodeHookInput`]，转换为 [`models::ZCodePetEvent`]
//!    并 `emit_to` pet 窗口，驱动宠物动画反馈。
//!
//! 三个子模块均刻意与 `commands` 模块解耦，自行定义 `PET_WINDOW_LABEL` 常量，
//! 避免跨模块循环依赖。

pub mod hook_server;
pub mod link;
pub mod models;
pub mod stats;

pub use hook_server::start as start_hook_server;
pub use link::{ensure_hook_script_installed, is_zcode_linked, set_zcode_linked, LinkResult};
