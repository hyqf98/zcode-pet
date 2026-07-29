import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import naive from 'naive-ui'
import App from './App.vue'
import { router } from './router'
import { messages, defaultLocale } from '@/locales'
import './assets/main.css'

// pet 窗口首帧就绪通知：module script 执行点 = DOMContentLoaded 后，此时 index.html 的
// 内联透明样式（html.pet-window body { background:transparent }）已应用，webview 不再是白底。
// 后端 show_pet_window/toggle_pet_window 等待本事件后才 show，消除白屏闪现。
// 不用 requestAnimationFrame —— 隐藏窗口的 webview 会被节流，rAF 不触发导致后端永远等不到事件。
// 非 pet 窗口无需 emit；emit 失败静默（后端有 800ms 超时兜底）。
if (/^\/pet(?:\/|$|\?)/.test(location.pathname)) {
  // 确保透明 class 就位（index.html 内联脚本已加 html.pet-window，这里补 body class）。
  document.body?.classList.add('pet-window-transparent')
  import('@tauri-apps/api/event')
    .then(({ emit }) => emit('pet-window-ready'))
    .catch(() => {})
}

// vue-i18n：消息采用扁平点号 key，故开启 flatJson 以正确解析
// （如 notif.tool.start 与 notif.tool.start.file 这类同前缀叶节点）。
// 运行时语言切换由集成代理在 PetManager 里 watch petSettings.locale 实现；
// 此处只负责初始装载。
const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'zh-CN',
  messages,
  flatJson: true
})

// petSettings 尚未挂载（Pinia 在下方 use），故直接读 localStorage
// 还原用户上次选择的语言。
try {
  const raw = localStorage.getItem('zcode-pet-settings')
  if (raw) {
    const saved = JSON.parse(raw) as { locale?: string }
    if (saved?.locale === 'zh-CN' || saved?.locale === 'en-US') {
      i18n.global.locale.value = saved.locale
    }
  }
} catch {
  /* ignore: 解析失败则保持默认语言 */
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(naive)
app.use(i18n)
app.mount('#app')

// 防御兜底：pet 窗口若在渲染/运行期抛出未捕获错误（Pixi 初始化失败等），
// 确保窗口保持「透明 + 鼠标穿透」状态，绝不退化为不透明遮挡层挡住整屏。
// （index.html 内联样式已让首帧透明，ensure_pet_window 已默认穿透；此处仅加固运行期。）
;(function ensurePetWindowSafeOnFatalError() {
  const isPetWindow =
    typeof location !== 'undefined' && /^\/pet(?:\/|$|\?)/.test(location.pathname)
  if (!isPetWindow) return

  const markTransparent = (): void => {
    document.documentElement.classList.add('pet-window')
    document.body?.classList.add('pet-window-transparent')
  }
  const forceClickThrough = (): void => {
    import('@tauri-apps/api/window')
      .then((m) => m.getCurrentWindow().setIgnoreCursorEvents(true))
      .catch(() => {})
  }

  window.addEventListener('error', () => {
    markTransparent()
    forceClickThrough()
  })
  window.addEventListener('unhandledrejection', () => {
    markTransparent()
    forceClickThrough()
  })
})()
