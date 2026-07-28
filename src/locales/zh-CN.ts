/**
 * 简体中文文案（zh-CN）。
 *
 * 采用「扁平点号 key」结构（如 `notif.tool.start`），配合 main.ts 里
 * createI18n 的 `flatJson: true` 解析。这样 `notif.tool.start` 与
 * `notif.tool.start.file` 这类「同前缀的叶节点」可共存而不冲突。
 *
 * key 分组：
 *   - notif.*  ：桌面宠物通知气泡文案（占位符 {tool}/{file}/{error}/{line}/{name}）
 *   - ui.app.* ：管理窗口标题/副标题
 *   - ui.pet.* ：宠物管理（列表/市场/卡片/空态/分页/分类/排序/标签）
 *   - ui.detail.*：详情弹窗
 *   - ui.zcode.*：ZCode 联动开关
 *   - ui.settings.*：设置项（语言等）
 *   - ui.tray.* ：系统托盘菜单
 *   - ui.common.*：通用按钮
 *   - ui.msg.*  ：操作反馈（toast）
 *
 * 其他集成代理（PetManager / notifications）会按这些 key 调用 t()。
 */
export default {
  // --- 通知气泡（notif.*）------------------------------------------------
  'notif.session.greet': '嗨！我是你的编程伙伴 👋',
  'notif.user.thinking': '思考中…',

  'notif.tool.start': '正在 {tool}…',
  'notif.tool.start.file': '正在 {tool}：{file}',
  'notif.tool.done': '✅ {tool} 完成',
  'notif.tool.failed': '❌ {tool} 失败：{error}',

  'notif.perm.need': '⚠️ 需要确认：{tool}',

  'notif.stop.done': '✅ 本轮完成',
  'notif.stop.done.line': '✅ 本轮完成：{line}',

  // --- 管理窗口标题（ui.app.*）------------------------------------------
  'ui.app.title': 'ZCode 桌面宠物',
  'ui.app.subtitle': '选一只陪伴你写代码的小家伙',

  // --- 宠物管理（ui.pet.*）----------------------------------------------
  'ui.pet.enable': '启用桌面宠物',
  'ui.pet.alwaysOnTop': '始终置顶',
  'ui.pet.scale': '宠物大小',
  'ui.pet.myPets': '我的宠物',
  'ui.pet.market': '宠物市场',
  'ui.pet.search': '搜索宠物…',

  // 状态条 / 引导
  'ui.pet.status.state': '状态',
  'ui.pet.status.running': '运行中',
  'ui.pet.status.closed': '已关闭',
  'ui.pet.status.current': '当前宠物',
  'ui.pet.status.unselected': '未选择',
  'ui.pet.guide.disabled': '宠物已关闭，打开右上角开关即可在桌面显示。先选一只喜欢的吧。',

  // 空态 / 加载
  'ui.pet.noLocal': '还没有宠物，去市场下载一只吧',
  'ui.pet.noLocalAlt': '还没有安装任何宠物，去市场看看吧',
  'ui.pet.loading': '加载中…',
  'ui.pet.noMarketResult': '没有找到匹配的宠物',
  'ui.pet.noMarketResultAlt': '未找到宠物，换个关键词试试',

  // 卡片标签
  'ui.pet.tag.builtin': '内置',
  'ui.pet.tag.inUse': '使用中',
  'ui.pet.tag.installed': '已安装',

  // 操作按钮
  'ui.pet.use': '使用',
  'ui.pet.delete': '删除',
  'ui.pet.download': '下载',
  'ui.pet.detail': '详情',
  'ui.pet.actions': '动作',
  'ui.pet.preview': '预览',
  'ui.pet.searchBtn': '搜索',
  'ui.pet.searchPlaceholder': '搜索宠物名称…',
  'ui.pet.prevPage': '上一页',
  'ui.pet.nextPage': '下一页',

  // 分类（kind）
  'ui.pet.kind.all': '全部',
  'ui.pet.kind.allCategory': '全部分类',
  'ui.pet.kind.person': '人物',
  'ui.pet.kind.animal': '动物',
  'ui.pet.kind.creature': '生物',
  'ui.pet.kind.object': '物品',

  // 排序（sort）
  'ui.pet.sort.new': '最新',
  'ui.pet.sort.popular': '热门',
  'ui.pet.sort.views': '浏览最多',
  'ui.pet.sort.discussed': '评论最多',
  'ui.pet.sort.random': '随机',

  // --- 详情弹窗（ui.detail.*）-------------------------------------------
  'ui.detail.downloadAndUse': '下载并使用',
  'ui.detail.setActive': '设为当前',
  'ui.detail.close': '关闭',
  'ui.detail.animTitle': '动画状态（点击预览）',
  'ui.detail.previewUnavailable': '预览不可用',

  // --- ZCode 联动（ui.zcode.*）------------------------------------------
  'ui.zcode.link': '启用 ZCode 联动',
  'ui.zcode.linkHint': '开启后，ZCode 的 AI 活动会驱动宠物反应（需重启 ZCode 生效）',
  'ui.zcode.linked': '已联动',
  'ui.zcode.unlinked': '未联动',
  'ui.zcode.relinkHint': '已更新配置，请新建 ZCode 会话生效',
  'ui.zcode.nodeMissing': '未检测到 Node.js，联动功能需要先安装 Node.js（https://nodejs.org）',
  'ui.zcode.nodeOk': '检测到 Node.js {version}，可以开启联动',

  // --- 设置项（ui.settings.*）-------------------------------------------
  'ui.settings.title': '设置',
  'ui.settings.language': '语言',

  // --- 系统托盘（ui.tray.*）---------------------------------------------
  'ui.tray.toggle': '显示/隐藏宠物',
  'ui.tray.openManager': '打开管理窗口',
  'ui.tray.alwaysOnTop': '始终置顶',
  'ui.tray.quit': '退出',

  // --- 通用按钮（ui.common.*）-------------------------------------------
  'ui.common.confirm': '确认',
  'ui.common.cancel': '取消',

  // --- 操作反馈 toast（ui.msg.*）----------------------------------------
  'ui.msg.downloaded': '已下载「{name}」并设为当前宠物',
  'ui.msg.downloadFailed': '下载失败：{error}',

  // --- 应用更新（ui.update.*）------------------------------------------
  'ui.update.available': '发现新版本 {version}',
  'ui.update.download': '下载更新',
  'ui.update.tooltip': '点击前往下载 {version}'
} as const
