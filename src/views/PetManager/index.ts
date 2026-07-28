/**
 * usePetManager — 宠物管理窗口主视图的 composable。
 *
 * 相比原 DesktopPetSettings：
 *   - settingsStore → petSettingsStore
 *   - EaButton/EaInput/EaSelect → Naive UI（在 index.vue 里直接用）
 *   - i18n → 硬编码中文（独立应用，文案量小）
 *   - 新增首次启动选择流逻辑
 *
 * 集成代理扩展（zcode-pet 联动）：
 *   - 接通 vue-i18n：选项 / label / 提示统一走 `t()`，文案 key 定义于 src/locales。
 *   - locale 切换：watch petSettings.locale → 同步 useI18n 的 `locale.value`（与全局同步）。
 *   - 缩放：双向绑定 petSettings.scale（PetView 监听重建 PetApp）。
 *   - ZCode 联动：`n-switch` 绑定 zcodeLinked，切换调 `link_zcode`，失败 toast，成功提示新建会话。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { usePetSettingsStore } from '@/stores/petSettings'
import { useDesktopPetStore } from '@/stores/desktopPet'
import { toLocalAssetUrl } from '@/services/desktopPet'
import { useAppUpdate } from '@/composables/useAppUpdate'
import type { AppLocale } from '@/locales'
import { supportedLocales } from '@/locales'
import type { CodexPetKind, CodexPetSort, LocalPetInfo } from '@/types/desktopPet'
import type { DetailPet } from './PetDetailModal/usePetDetailModal'

/** 子 tab：我的宠物 / 宠物市场。 */
type SubTab = 'local' | 'market'

/** 排序选项。 */
interface Option {
  value: string
  label: string
}

export function usePetManager() {
  const message = useMessage()
  const { t, locale } = useI18n()
  const petSettings = usePetSettingsStore()
  const desktopPetStore = useDesktopPetStore()
  const { updateInfo, checkForAppUpdate } = useAppUpdate()

  const activeSubTab = ref<SubTab>('local')

  // --- 设置区折叠状态 -----------------------------------------------------
  // 默认收起：设置区常驻会挤压宠物列表垂直空间，收起后宠物列表获得最大高度。
  const settingsOpen = ref(false)

  // --- 详情弹窗状态 ------------------------------------------------------
  const detailVisible = ref(false)
  const detailPet = ref<DetailPet | null>(null)

  // --- ZCode 联动状态 ----------------------------------------------------
  // 与后端 `link_zcode(enabled)` 返回的 LinkResult 对齐（serde camelCase）。
  interface ZCodeLinkResult {
    ok: boolean
    linked: boolean
    scriptPath: string
    configPath: string
  }
  /** 当前联动状态（onMounted 拉取真实值；切换时按返回值更新）。 */
  const zcodeLinked = ref(false)
  /** 切换中（禁用 switch，防止重复 IPC）。 */
  const zcodeToggling = ref(false)

  // --- 选项 --------------------------------------------------------------

  const sortOptions = computed<Option[]>(() => [
    { value: 'new', label: t('ui.pet.sort.new') },
    { value: 'popular', label: t('ui.pet.sort.popular') },
    { value: 'views', label: t('ui.pet.sort.views') },
    { value: 'discussed', label: t('ui.pet.sort.discussed') },
    { value: 'random', label: t('ui.pet.sort.random') }
  ])

  const kindOptions = computed<Option[]>(() => [
    { value: '', label: t('ui.pet.kind.allCategory') },
    { value: 'person', label: t('ui.pet.kind.person') },
    { value: 'animal', label: t('ui.pet.kind.animal') },
    { value: 'creature', label: t('ui.pet.kind.creature') },
    { value: 'object', label: t('ui.pet.kind.object') }
  ])

  /** 语言下拉选项（label 本地化）。 */
  const languageOptions = computed<Option[]>(() => [
    { value: 'zh-CN', label: '中文' },
    { value: 'en-US', label: 'English' }
  ])

  /** 缩放滑块范围（与 PetView scale/100 一致）。 */
  const SCALE_MIN = 50
  const SCALE_MAX = 125
  const SCALE_STEP = 5

  // --- handlers：开关 ----------------------------------------------------

  /** 启用/禁用桌面宠物。开启时显示窗口；关闭时隐藏。 */
  async function handleToggleEnabled(enabled: boolean): Promise<void> {
    petSettings.enabled = enabled
    if (enabled) {
      await desktopPetStore.loadLocalPets()
      await desktopPetStore.showPet()
    } else {
      await desktopPetStore.hidePet()
    }
  }

  /** 切换始终置顶。 */
  async function handleToggleAlwaysOnTop(value: boolean): Promise<void> {
    await desktopPetStore.setAlwaysOnTop(value)
  }

  /**
   * 选择宠物为当前使用。
   * 若宠物未启用，则自动开启并显示悬浮窗。
   */
  async function handleSelectPet(petId: string): Promise<void> {
    await desktopPetStore.setActivePet(petId)
    if (!petSettings.enabled) {
      petSettings.enabled = true
      await desktopPetStore.showPet()
    }
  }

  // --- handlers：详情弹窗 ------------------------------------------------

  /** 本地宠物 → 详情（src 用 convertFileSrc）。 */
  function openLocalDetail(pet: LocalPetInfo): void {
    detailPet.value = {
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      kind: pet.kind,
      tags: pet.tags,
      spritesheetSrc: toLocalAssetUrl(pet.spritesheetPath),
      installed: true,
      source: pet.source,
      installedAt: pet.installedAt
    }
    detailVisible.value = true
  }

  /** 远程市场宠物 → 详情。 */
  function openRemoteDetail(pet: {
    id: string
    displayName: string
    description?: string | null
    kind?: string | null
    tags: string[]
    spritesheetUrl?: string | null
    downloadCount?: number | null
    viewCount?: number | null
  }): void {
    const src = pet.spritesheetUrl ?? ''
    detailPet.value = {
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      kind: pet.kind,
      tags: pet.tags,
      spritesheetSrc: src,
      installed: desktopPetStore.isInstalled(pet.id),
      source: 'remote',
      downloadCount: pet.downloadCount,
      viewCount: pet.viewCount
    }
    detailVisible.value = true
  }

  /** 详情弹窗：下载（并设为激活）。 */
  async function handleDetailDownload(petId: string): Promise<void> {
    try {
      const info = await desktopPetStore.downloadPet(petId, true)
      message.success(`已下载「${info.displayName}」并设为当前宠物`, {
        duration: 3500
      })
    } catch (e) {
      message.error(`下载失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 详情弹窗：设为当前宠物。 */
  async function handleDetailUse(petId: string): Promise<void> {
    await desktopPetStore.setActivePet(petId)
  }

  // --- handlers：市场搜索 ------------------------------------------------

  /** 远程搜索输入（回车触发）。 */
  async function handleSearchSubmit(): Promise<void> {
    await desktopPetStore.refreshRemote()
  }

  /** 切换排序/分类后立即刷新。 */
  async function handleFilterChange(): Promise<void> {
    await desktopPetStore.refreshRemote()
  }

  // --- handlers：语言 / 缩放 / ZCode 联动 -------------------------------

  /**
   * 切换界面语言：同步写入 petSettings.locale（持久化）与 useI18n 的 locale.value
   * （后者与全局 i18n.global.locale 同步，legacy:false 模式下即时生效）。
   */
  function handleLanguageChange(value: AppLocale): void {
    petSettings.locale = value
    locale.value = value
  }

  /**
   * 切换缩放百分比。仅写 store（持久化 + 联动）；PetView 监听该字段重建 PetApp。
   * 钳制到 [50, 125] 以 5 为步进，避免越界。
   */
  function handleScaleChange(value: number): void {
    const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, value))
    petSettings.scale = clamped
  }

  /**
   * 切换 ZCode shell hook 联动：调 `link_zcode(enabled)`，成功提示「新建会话生效」，
   * 失败回滚 switch 状态并 toast 报错。
   *
   * 开启前先检测系统 Node.js：hook 脚本以 `node <script>` 被 ZCode 拉起，
   * 无 node 则联动静默失效，故提前拦截并提示用户安装。
   */
  async function handleToggleZCodeLink(enabled: boolean): Promise<void> {
    if (zcodeToggling.value) return
    zcodeToggling.value = true
    try {
      // 开启联动前检测 Node.js 是否可用（关闭不需要）。
      if (enabled) {
        try {
          const version = await invoke<string>('check_node_available')
          message.success(t('ui.zcode.nodeOk', { version }), { duration: 2500 })
        } catch {
          // node 不可用：回滚开关并提示安装，不继续注入配置。
          zcodeLinked.value = false
          message.error(t('ui.zcode.nodeMissing'), { duration: 6000 })
          return
        }
      }

      const result = await invoke<ZCodeLinkResult>('link_zcode', { enabled })
      if (!result.ok) {
        // 操作未成功：回滚 UI 状态并提示。
        zcodeLinked.value = !enabled
        message.error(t('ui.zcode.relinkHint'))
        return
      }
      zcodeLinked.value = result.linked
      message.info(t('ui.zcode.relinkHint'), { duration: 4000 })
    } catch (e) {
      // 异常：回滚 UI 状态并报错。
      zcodeLinked.value = !enabled
      message.error(String(e instanceof Error ? e.message : e))
    } finally {
      zcodeToggling.value = false
    }
  }

  /** 卡片快捷下载。 */
  async function handleQuickDownload(petId: string): Promise<void> {
    try {
      const info = await desktopPetStore.downloadPet(petId, true)
      message.success(`已下载「${info.displayName}」并设为当前宠物`, {
        duration: 3500
      })
    } catch (e) {
      message.error(`下载失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * 打开新版本下载页（GitHub Releases latest）。
   * Tauri 运行时用 opener 插件唤起系统浏览器；开发环境 fallback 到 window.open。
   */
  async function handleDownloadUpdate(): Promise<void> {
    const url = updateInfo.value.downloadUrl
    if (!url) return
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch {
      window.open(url, '_blank', 'noopener')
    }
  }

  // --- 生命周期 ----------------------------------------------------------

  onMounted(async () => {
    // 启动时按持久化语言同步 i18n（main.ts 已尝试，这里确保管理窗口内一致）。
    locale.value = petSettings.locale

    // 拉取 ZCode 联动真实状态初始化开关。
    try {
      zcodeLinked.value = await invoke<boolean>('get_zcode_link_status')
    } catch (e) {
      console.error('[PetManager] get_zcode_link_status failed:', e)
      zcodeLinked.value = false
    }

    await desktopPetStore.loadLocalPets()
    await desktopPetStore.refreshRemote()

    // 静默检测应用更新（失败不影响主流程；有新版本时顶部显示下载按钮）。
    void checkForAppUpdate()
  })

  // petSettings.locale 被外部改写（如 PetView storage 事件）时同步 i18n。
  watch(
    () => petSettings.locale,
    (value) => {
      if (supportedLocales.includes(value)) {
        locale.value = value
      }
    }
  )

  return {
    // i18n
    t,
    // stores
    petSettings,
    desktopPetStore,
    // options
    sortOptions,
    kindOptions,
    languageOptions,
    scaleMin: SCALE_MIN,
    scaleMax: SCALE_MAX,
    scaleStep: SCALE_STEP,
    // sub-tab
    activeSubTab,
    // settings collapse
    settingsOpen,
    // app update
    updateInfo,
    handleDownloadUpdate,
    // detail modal
    detailVisible,
    detailPet,
    // zcode link
    zcodeLinked,
    zcodeToggling,
    // handlers
    handleToggleEnabled,
    handleToggleAlwaysOnTop,
    handleSelectPet,
    openLocalDetail,
    openRemoteDetail,
    handleDetailDownload,
    handleDetailUse,
    handleSearchSubmit,
    handleFilterChange,
    handleQuickDownload,
    handleLanguageChange,
    handleScaleChange,
    handleToggleZCodeLink,
    // utils
    toLocalAssetUrl
  }
}

export type { CodexPetKind, CodexPetSort, LocalPetInfo }
