// 桌面宠物对话模拟工具（纯函数）。
//
// 在接入 ACP 真实对话前，用于模拟 SSE 流式输出：把一段完整文案切成小 token，
// 让视图层按节奏逐个 appendChatToken，实现打字机效果。纯逻辑、无副作用，便于单测。

import type { RandomSource } from './engine/types'

/**
 * 把一段文本切成若干"token"，模拟流式增量。
 *
 * 以码点（支持中文）按 maxCharsPerChunk 切分；空串返回空数组。最后一个 chunk 可能短于上限。
 */
export function chunkMessage(text: string, maxCharsPerChunk = 2): string[] {
  if (maxCharsPerChunk < 1) {
    throw new Error('maxCharsPerChunk must be >= 1')
  }
  if (text.length === 0) return []

  // Array.from 正确处理 Unicode 码点（emoji / 扩展汉字）。
  const codepoints = Array.from(text)
  const chunks: string[] = []

  for (let i = 0; i < codepoints.length; i += maxCharsPerChunk) {
    chunks.push(codepoints.slice(i, i + maxCharsPerChunk).join(''))
  }

  return chunks
}

/** 友好中文短句池 —— 模拟宠物"想说的话"。后续接入 ACP 后不再使用。 */
export const CANNED_MESSAGES: readonly string[] = [
  '嗨！很高兴见到你～',
  '今天也要元气满满哦！',
  '接下来我会接入 ACP，就能真正陪你聊天啦～',
  '哼哼，偷偷摸鱼被你发现了。',
  '需要我帮你跑一个任务吗？',
  '喝杯奶茶歇一会儿吧～'
]

// --- 按时间段的俏皮语录（鼠标悬停时随机显示一条） ---
// 每个时间段 10 条，风格轻松幽默，贴合打工人的真实心境。

/** 凌晨语录（0:00 - 5:59）：熬夜 / 修仙主题。 */
const QUOTES_DAWN: readonly string[] = [
  '都这个点了还不睡？修仙带我一个！',
  '夜深了，bug 也该睡觉了吧～',
  '你的黑眼圈比我的精灵图还黑了。',
  '凌晨写代码，灵感最足？还是头最秃？',
  '月亮不睡你不睡，你是秃头小宝贝。',
  '这个点还在肝，明天不用上班吗？',
  '夜深人静，只有键盘声陪着你呢。',
  '再熬下去你的发际线要退到后脑勺了哦。',
  '嘘——别吵醒正在睡觉的 bug。',
  '凌晨的代码最易出 bug，信我。'
]

/** 早上语录（6:00 - 10:59）：起床 / 摸鱼 / 新一天主题。 */
const QUOTES_MORNING: readonly string[] = [
  '早上好呀！又是摸鱼的一天～',
  '早安！今天的你比昨天更想请假了吗？',
  '新的一天，新的 bug 在等你。',
  '元气满满！先把昨天挖的坑填一下吧。',
  '咖啡续命，代码飘飘～',
  '老板还没来，先摸会儿鱼吧。',
  '早上写代码效率最高，骗你的。',
  '又是元气满满被打回原形的一天呢！',
  '今天的 todo：活着下班。',
  '起这么早？卷王之王非你莫属！'
]

/** 中午语录（11:00 - 13:59）：午饭 / 午休主题。 */
const QUOTES_NOON: readonly string[] = [
  '中午啦，你去休息交给我吧！',
  '干饭时间到！键盘先放一放～',
  '午饭后犯困正常，代码又不会跑掉。',
  '吃了没？别光顾着写代码饿坏了。',
  '中午不睡，下午崩溃，听我的。',
  '饭点到了，bug 也要吃饭的。',
  '午休一下吧，我会替你盯着屏幕的～',
  '别吃了，你看你肚子上那圈…开玩笑的快去吃！',
  '中午的阳光真好，适合摸鱼。',
  '先去吃饭，回来再和这个 bug 决一死战！'
]

/** 下午语录（14:00 - 17:59）：犯困 / 摸鱼 / 等下班主题。 */
const QUOTES_AFTERNOON: readonly string[] = [
  '下午好困啊，要不趴会儿？',
  '距离下班还有…我帮你数着呢。',
  '下午茶时间！奶茶还是咖啡？',
  '这个点了，今天能下班吗？',
  '下午的代码，写一行删两行。',
  '困了就站起来活动活动～别学我坐着不动。',
  '老板走过去了吗？可以摸鱼了吗？',
  '下午三点了，灵感枯竭期，正常正常。',
  '再撑两个小时就下班了，加油！',
  '下午的 bug 特别难搞，是不是到了下午茶时间？'
]

/** 晚上语录（18:00 - 23:59）：加班 / 放松 / 夜生活主题。 */
const QUOTES_EVENING: readonly string[] = [
  '晚上好！还在加班？辛苦了～',
  '天黑了，该下班回家啦。',
  '晚饭吃了吗？别亏待自己。',
  '加班费记得要啊，别白干！',
  '晚上的代码写得快，因为想赶紧回家。',
  '今天辛苦了，给自己点个夜宵吧。',
  '这么晚还在写代码？对象不心疼你吗？',
  '夜幕降临，bug 也该下班了呀。',
  '别卷了，回家吧，键盘也需要休息。',
  '晚上写代码容易上头，注意别熬太晚哦。'
]

/** 按当前小时返回对应时间段语录池。 */
function getQuotesByHour(hour: number): readonly string[] {
  if (hour >= 0 && hour < 6) return QUOTES_DAWN
  if (hour >= 6 && hour < 11) return QUOTES_MORNING
  if (hour >= 11 && hour < 14) return QUOTES_NOON
  if (hour >= 14 && hour < 18) return QUOTES_AFTERNOON
  return QUOTES_EVENING
}

/**
 * 从固定短句池随机取一条（用注入的 rng 保证可测）。
 */
export function pickCannedMessage(rng: RandomSource = Math.random): string {
  const index = Math.floor(rng() * CANNED_MESSAGES.length) % CANNED_MESSAGES.length
  return CANNED_MESSAGES[index]
}

/**
 * 按当前时间段从对应语录池随机取一条俏皮消息（鼠标悬停时用）。
 *
 * 根据当前系统时间的小时分段（凌晨/早上/中午/下午/晚上）选择语录池，
 * 每个池 10 条贴合打工人心境的幽默短句，随机返回一条。
 *
 * @param rng 随机源（默认 Math.random，可注入便于测试）
 * @param date 用于判断时间段的日期（默认 new Date()，可注入便于测试）
 */
export function pickTimeBasedMessage(
  rng: RandomSource = Math.random,
  date: Date = new Date()
): string {
  const quotes = getQuotesByHour(date.getHours())
  const index = Math.floor(rng() * quotes.length) % quotes.length
  return quotes[index]
}
