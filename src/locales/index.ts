/**
 * i18n 资源入口：聚合各语言文案，并导出 locale 类型与常量。
 *
 * 设计要点：
 *   - 消息采用「扁平点号 key」，配合 main.ts 中 createI18n 的 `flatJson: true`
 *     解析（可让 `notif.tool.start` 与 `notif.tool.start.file` 这类同前缀叶节点共存）。
 *   - `AppLocale` 限定为受支持的语言代码；`supportedLocales` 用于设置项渲染。
 *   - `defaultLocale` 作为首次启动 / 解析失败时的回退语言。
 *
 * 运行时语言切换由集成代理（PetManager）通过 watch petSettings.locale
 * → i18n.global.locale.value 实现；本文件只提供静态资源与元数据。
 */
import zhCN from './zh-CN'
import enUS from './en-US'

/** 受支持的应用语言代码。 */
export type AppLocale = 'zh-CN' | 'en-US'

/** 以 locale 代码为键的消息集合（喂给 createI18n 的 messages）。 */
export const messages = { 'zh-CN': zhCN, 'en-US': enUS } as const

/** 受支持语言列表（设置下拉用）。 */
export const supportedLocales: AppLocale[] = ['zh-CN', 'en-US']

/** 默认语言（首次启动 / 回退）。 */
export const defaultLocale: AppLocale = 'zh-CN'
