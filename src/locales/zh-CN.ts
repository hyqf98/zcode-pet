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
  'notif.tool.read': '📖 读取 {file}',
  'notif.tool.write': '✏️ 写入 {file}',
  'notif.tool.edit': '✏️ 编辑 {file}',
  'notif.tool.bash': '⚙️ 执行：{command}',
  'notif.tool.search': '🔍 搜索：{pattern}',
  'notif.tool.subagent': '🤖 子代理：{desc}',
  'notif.tool.subagent.generic': '🤖 调用子代理…',
  'notif.tool.webfetch': '🌐 抓取：{url}',
  'notif.tool.webfetch.generic': '🌐 抓取网页…',
  'notif.tool.websearch': '🌐 搜索：{query}',
  'notif.tool.websearch.generic': '🌐 搜索网络…',
  'notif.tool.done': '✅ {tool} 完成',
  'notif.tool.done.file': '✅ {tool} 完成：{file}',
  'notif.tool.failed': '❌ {tool} 失败：{error}',

  'notif.perm.need': '⚠️ 需要确认：{tool}',

  'notif.stop.done': '✅ 本轮完成',
  'notif.stop.done.line': '✅ 本轮完成：{line}',
  'notif.stop.empty': '⚠️ 本轮结束（无输出）',

  // --- 管理窗口标题（ui.app.*）------------------------------------------
  'ui.app.title': 'ZCode 桌面宠物',
  'ui.app.subtitle': '选一只陪伴你写代码的小家伙',

  // --- 宠物管理（ui.pet.*）----------------------------------------------
  'ui.pet.enable': '启用桌面宠物',
  'ui.pet.alwaysOnTop': '始终置顶',
  'ui.pet.scale': '宠物大小',
  'ui.pet.movementMode': '漫游模式',
  'ui.pet.movementFree': '自由漫游',
  'ui.pet.movementFixed': '固定位置',
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

  // --- Token 使用量统计（ui.stats.*）-------------------------------------
  'ui.stats.dataDir': 'ZCode 数据目录',
  'ui.stats.autoDetected': '已自动检测',
  'ui.stats.notDetected': '未检测到',
  'ui.stats.dataDirPlaceholder': '留空则自动检测，或填写 ~/.zcode 所在目录',
  'ui.stats.dataDirApply': '应用',
  'ui.stats.dataDirOk': '数据目录已生效',
  'ui.stats.dataDirNotFound': '该目录下未找到 ZCode 数据库，请检查路径',
  'ui.stats.dataDirError': '设置失败：{error}',
  'ui.stats.today': '今日',
  'ui.stats.calls': '次调用',
  'ui.stats.noData': '今天还没有 AI 活动哦~',

  // --- 市场网络代理（ui.proxy.*）-----------------------------------------
  'ui.proxy.title': '网络代理',
  'ui.proxy.mode.auto': '自动（Clash 默认）',
  'ui.proxy.mode.direct': '直连（不使用代理）',
  'ui.proxy.mode.custom': '自定义',
  'ui.proxy.customPlaceholder': 'http://127.0.0.1:7890',
  'ui.proxy.apply': '应用',
  'ui.proxy.test': '测试连接',
  'ui.proxy.connected': '连接正常（{ms}ms）',
  'ui.proxy.failed': '连接失败：{error}',
  'ui.proxy.marketError': '无法连接宠物市场，请检查网络代理设置（建议使用 Clash 默认端口 7890）',

  // --- 本地导入（ui.pet.import*）-----------------------------------------
  'ui.pet.import': '导入宠物',
  'ui.pet.importSuccess': '已导入「{name}」并设为当前宠物',
  'ui.pet.importFailed': '导入失败：{error}',
  'ui.pet.tag.uploaded': '已上传',

  // --- 删除（ui.pet.delete*）---------------------------------------------
  'ui.pet.deleteConfirm': '确定要删除「{name}」吗？',
  'ui.pet.deleteSuccess': '已删除宠物',
  'ui.pet.deleteBuiltin': '内置宠物不能删除',

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
  'ui.update.installing': '正在安装…',
  'ui.update.downloadFailed': '更新失败：{error}',
  'ui.update.tooltip': '点击下载并安装 {version}（安装后自动重启）'
} as const
