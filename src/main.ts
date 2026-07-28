import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import naive from 'naive-ui'
import App from './App.vue'
import { router } from './router'
import { messages, defaultLocale } from '@/locales'
import './assets/main.css'

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
