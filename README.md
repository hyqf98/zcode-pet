# ZCode 桌面宠物 (ZCodePet)

一款基于 Tauri 2 的独立桌面宠物应用，选一只陪伴你写代码的小家伙 🐱

宠物会常驻桌面悬浮窗，根据 ZCode（AI 编程助手）的活动做出反应：工具开始时忙碌、完成时庆祝、报错时心疼……让编程不再孤单。

## ✨ 功能特性

- 🐾 **桌面悬浮宠物** — 透明无边框窗口，常驻桌面，支持拖拽与始终置顶
- 🎭 **精灵图动画引擎** — 基于 PixiJS 的逐帧动画系统，支持多状态切换（idle / happy / sad / busy…）
- 🛒 **宠物市场** — 浏览 [codex-pets.net](https://codex-pets.net) 市场，一键下载更多宠物
- 🔔 **ZCode 联动** — 接入 ZCode Hook，AI 工具活动实时驱动宠物反应（工具开始/完成/失败/权限确认）
- 🌍 **多语言** — 内置中文 / English，运行时切换
- 📦 **跨平台** — 支持 macOS / Windows / Linux
- 🔄 **自动更新检测** — 启动时检测 GitHub Release 新版本，有更新时顶部显示下载按钮

## 📥 下载安装

前往 [Releases](https://github.com/hyqf98/zcode-pet/releases/latest) 下载最新版本：

| 平台 | 安装包 |
|------|--------|
| **macOS** (Apple Silicon + Intel) | `.dmg` |
| **Windows** | `-setup.exe` (NSIS 安装程序) |
| **Linux** | `.deb` / `.AppImage` |

### 系统要求

- macOS 10.13+
- Windows 10+
- Ubuntu 20.04+ / Debian 11+（需 `libwebkit2gtk-4.1-0`）

## 🚀 本地开发

### 环境要求

- [Node.js](https://nodejs.org) 22+
- [pnpm](https://pnpm.io) 9+
- [Rust](https://www.rust-lang.org) stable（含 `cargo`）
- Tauri 2 系统依赖：参考 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)

### 启动

```bash
# 安装前端依赖
pnpm install

# 开发模式（启动 Tauri 开发服务器）
pnpm tauri dev

# 类型检查
pnpm typecheck

# 打包构建（当前平台）
pnpm tauri build
```

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3.5 + TypeScript + Vite 6 |
| UI 组件 | Naive UI + Tailwind CSS |
| 状态管理 | Pinia |
| 动画引擎 | PixiJS 8 |
| 国际化 | vue-i18n |
| 桌面框架 | Tauri 2 |
| 后端 | Rust (2021 edition) |

## 📂 项目结构

```
zcode_pet/
├── src/                      # 前端源码（Vue 3）
│   ├── modules/desktopPet/   # 宠物核心引擎（PixiJS 动画 / 通知队列）
│   ├── views/                # 视图（PetManager 管理 / PetView 悬浮窗）
│   ├── stores/               # Pinia 状态管理
│   ├── composables/          # 可复用逻辑（更新检测 / 事件监听）
│   └── locales/              # 国际化文案（zh-CN / en-US）
├── src-tauri/                # Tauri 后端（Rust）
│   ├── src/
│   │   ├── commands/         # IPC 命令层
│   │   ├── zcode/            # ZCode Hook 集成
│   │   └── lib.rs            # 应用入口 + 托盘
│   ├── resources/pets/       # 内置宠物资源（打包进安装包）
│   └── tauri.conf.json       # Tauri 配置
├── .github/workflows/        # CI/CD（自动打包发布）
└── package.json
```

## 🔄 自动更新

应用启动时会自动调用 GitHub Releases API 检测新版本。若存在更高版本，管理窗口顶部会出现一个带脉冲圆点的 **下载更新** 按钮，点击后跳转至 Release 页面下载对应平台的安装包。

> 此方案无需签名密钥，轻量可靠，适合开源项目。

## 📦 发布流程

本项目通过 GitHub Actions 自动打包发布：

1. 代码合并到 `main` 分支
2. 推送形如 `v1.0.0` 的 tag（带 `v` 前缀）
3. CI 自动在 macOS / Windows / Linux 三平台并行构建
4. 构建产物自动上传到 GitHub Release

```bash
# 发布新版本
git tag v1.1.0
git push origin v1.1.0
```

## 📄 许可证

MIT License
