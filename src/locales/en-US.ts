/**
 * English (US) messages (en-US).
 *
 * Mirrors the key structure of `./zh-CN` exactly (flat dotted keys).
 * Placeholders use the same {tool}/{file}/{error}/{line}/{name} tokens.
 * Loaded via createI18n with `flatJson: true` in main.ts.
 */
export default {
  // --- Notification bubbles (notif.*) -----------------------------------
  'notif.session.greet': "Hi! I'm your coding buddy 👋",
  'notif.user.thinking': 'Thinking…',

  'notif.tool.start': 'Running {tool}…',
  'notif.tool.start.file': 'Running {tool}: {file}',
  'notif.tool.read': '📖 Reading {file}',
  'notif.tool.write': '✏️ Writing {file}',
  'notif.tool.edit': '✏️ Editing {file}',
  'notif.tool.bash': '⚙️ Running: {command}',
  'notif.tool.search': '🔍 Searching: {pattern}',
  'notif.tool.subagent': '🤖 Subagent: {desc}',
  'notif.tool.subagent.generic': '🤖 Calling subagent…',
  'notif.tool.webfetch': '🌐 Fetching: {url}',
  'notif.tool.webfetch.generic': '🌐 Fetching web…',
  'notif.tool.websearch': '🌐 Searching: {query}',
  'notif.tool.websearch.generic': '🌐 Searching web…',
  'notif.tool.done': '✅ {tool} done',
  'notif.tool.done.file': '✅ {tool} done: {file}',
  'notif.tool.failed': '❌ {tool} failed: {error}',

  'notif.perm.need': '⚠️ Needs confirmation: {tool}',

  'notif.stop.done': '✅ Turn complete',
  'notif.stop.done.line': '✅ Turn complete: {line}',
  'notif.stop.empty': '⚠️ Turn ended (no output)',

  // --- Manager window title (ui.app.*) ----------------------------------
  'ui.app.title': 'ZCode Desktop Pet',
  'ui.app.subtitle': 'Pick a little buddy to keep you company while you code',

  // --- Pet management (ui.pet.*) ----------------------------------------
  'ui.pet.enable': 'Enable desktop pet',
  'ui.pet.alwaysOnTop': 'Always on top',
  'ui.pet.scale': 'Pet size',
  'ui.pet.movementMode': 'Roam mode',
  'ui.pet.movementFree': 'Free roam',
  'ui.pet.movementFixed': 'Fixed in place',
  'ui.pet.myPets': 'My pets',
  'ui.pet.market': 'Pet market',
  'ui.pet.search': 'Search pets…',

  // Status bar / guide
  'ui.pet.status.state': 'Status',
  'ui.pet.status.running': 'Running',
  'ui.pet.status.closed': 'Off',
  'ui.pet.status.current': 'Current pet',
  'ui.pet.status.unselected': 'Not selected',
  'ui.pet.guide.disabled': 'The pet is off. Toggle the switch in the top-right to show it on your desktop. Pick one you like first.',

  // Empty / loading
  'ui.pet.noLocal': 'No pets yet — grab one from the market',
  'ui.pet.noLocalAlt': 'No pets installed yet. Check out the market.',
  'ui.pet.loading': 'Loading…',
  'ui.pet.noMarketResult': 'No matching pets found',
  'ui.pet.noMarketResultAlt': 'No pets found. Try a different keyword.',

  // Card tags
  'ui.pet.tag.builtin': 'Built-in',
  'ui.pet.tag.inUse': 'In use',
  'ui.pet.tag.installed': 'Installed',

  // Action buttons
  'ui.pet.use': 'Use',
  'ui.pet.delete': 'Delete',
  'ui.pet.download': 'Download',
  'ui.pet.detail': 'Details',
  'ui.pet.actions': 'Actions',
  'ui.pet.preview': 'Preview',
  'ui.pet.searchBtn': 'Search',
  'ui.pet.searchPlaceholder': 'Search pet name…',
  'ui.pet.prevPage': 'Prev',
  'ui.pet.nextPage': 'Next',

  // Kind filters
  'ui.pet.kind.all': 'All',
  'ui.pet.kind.allCategory': 'All categories',
  'ui.pet.kind.person': 'Person',
  'ui.pet.kind.animal': 'Animal',
  'ui.pet.kind.creature': 'Creature',
  'ui.pet.kind.object': 'Object',

  // Sort options
  'ui.pet.sort.new': 'Newest',
  'ui.pet.sort.popular': 'Popular',
  'ui.pet.sort.views': 'Most viewed',
  'ui.pet.sort.discussed': 'Most discussed',
  'ui.pet.sort.random': 'Random',

  // --- Detail modal (ui.detail.*) ---------------------------------------
  'ui.detail.downloadAndUse': 'Download & use',
  'ui.detail.setActive': 'Set as current',
  'ui.detail.close': 'Close',
  'ui.detail.animTitle': 'Animations (click to preview)',
  'ui.detail.previewUnavailable': 'Preview unavailable',

  // --- ZCode integration (ui.zcode.*) -----------------------------------
  'ui.zcode.link': 'Enable ZCode link',
  'ui.zcode.linkHint': 'When on, ZCode AI activity drives pet reactions (restart ZCode to take effect).',
  'ui.zcode.linked': 'Linked',
  'ui.zcode.unlinked': 'Not linked',
  'ui.zcode.relinkHint': 'Config updated — start a new ZCode session to apply.',
  'ui.zcode.nodeMissing': 'Node.js not found. The link feature requires Node.js installed first (https://nodejs.org).',
  'ui.zcode.nodeOk': 'Found Node.js {version}, ready to link.',

  // --- Token usage stats (ui.stats.*) -----------------------------------
  'ui.stats.dataDir': 'ZCode data directory',
  'ui.stats.autoDetected': 'Auto-detected',
  'ui.stats.notDetected': 'Not detected',
  'ui.stats.dataDirPlaceholder': 'Leave empty for auto-detect, or enter the dir containing ~/.zcode',
  'ui.stats.dataDirApply': 'Apply',
  'ui.stats.dataDirOk': 'Data directory applied',
  'ui.stats.dataDirNotFound': 'ZCode database not found in that directory, please check the path',
  'ui.stats.dataDirError': 'Failed: {error}',
  'ui.stats.today': 'Today',
  'ui.stats.calls': ' calls',
  'ui.stats.noData': 'No AI activity today yet~',

  // --- Market proxy (ui.proxy.*) -----------------------------------------
  'ui.proxy.title': 'Network proxy',
  'ui.proxy.mode.auto': 'Auto (Clash default)',
  'ui.proxy.mode.direct': 'Direct (no proxy)',
  'ui.proxy.mode.custom': 'Custom',
  'ui.proxy.customPlaceholder': 'http://127.0.0.1:7890',
  'ui.proxy.apply': 'Apply',
  'ui.proxy.test': 'Test',
  'ui.proxy.connected': 'Connected ({ms}ms)',
  'ui.proxy.failed': 'Failed: {error}',
  'ui.proxy.marketError': 'Cannot connect to pet market. Check your proxy settings (Clash default port: 7890).',

  // --- Local import (ui.pet.import*) -------------------------------------
  'ui.pet.import': 'Import pet',
  'ui.pet.importSuccess': 'Imported "{name}" and set as current pet',
  'ui.pet.importFailed': 'Import failed: {error}',
  'ui.pet.tag.uploaded': 'Uploaded',

  // --- Delete (ui.pet.delete*) -------------------------------------------
  'ui.pet.deleteConfirm': 'Delete "{name}"?',
  'ui.pet.deleteSuccess': 'Pet deleted',
  'ui.pet.deleteBuiltin': 'Built-in pets cannot be deleted',

  // --- Settings (ui.settings.*) -----------------------------------------
  'ui.settings.title': 'Settings',
  'ui.settings.language': 'Language',

  // --- System tray (ui.tray.*) ------------------------------------------
  'ui.tray.toggle': 'Show/hide pet',
  'ui.tray.openManager': 'Open manager',
  'ui.tray.alwaysOnTop': 'Always on top',
  'ui.tray.quit': 'Quit',

  // --- Common buttons (ui.common.*) -------------------------------------
  'ui.common.confirm': 'OK',
  'ui.common.cancel': 'Cancel',

  // --- Toast messages (ui.msg.*) ----------------------------------------
  'ui.msg.downloaded': 'Downloaded "{name}" and set as current pet',
  'ui.msg.downloadFailed': 'Download failed: {error}',

  // --- App update (ui.update.*) ----------------------------------------
  'ui.update.available': 'New version {version} available',
  'ui.update.download': 'Download update',
  'ui.update.installing': 'Installing…',
  'ui.update.downloadFailed': 'Update failed: {error}',
  'ui.update.tooltip': 'Click to download and install {version} (restarts automatically)'
} as const
