// Token 用量调侃文案（纯函数）。
//
// 根据今日 token 总量 + 调用次数，把用量分成若干档（判断规则范围），每档一组调皮短句池，
// 每次展示随机挑一句拼到统计行后面。让"📊 今日 X · Y次调用"不再干巴巴，给点情绪反馈。
//
// 纯逻辑、无副作用、不依赖 i18n / DOM / Tauri，便于 node 环境单测。
// 文案沿用 chatSim.ts 的「硬编码中文调皮短句」风格（非关键功能，不做 i18n）。

import type { RandomSource } from './engine/types'

/**
 * Token 用量档位（判断规则范围，由 {@link resolveTier} 按阈值选取）。
 *
 * 阈值规则（用户指定）：
 * - `rookie`  比较垃圾 / 摸鱼：token < 1000 万
 * - `steady`  还算可以：1000 万 ~ 1 亿
 * - `titan`   比较牛逼：token ≥ 1 亿 或 调用 ≥ 500 次
 */
type TokenTier = 'rookie' | 'steady' | 'titan'

/** 各档阈值（token 数）。 */
const TIER_THRESHOLDS = {
  rookie: 0,
  steady: 10_000_000, // 1000 万
  titan: 100_000_000, // 1 亿
} as const

/** 大佬档的调用次数直通线：调用 ≥ 500 次即便 token 不到 1 亿也按大佬对待。 */
const TITAN_CALLS_DIRECT = 500

/** 各档调皮短句池（每档 ≥ 10 条，展示时随机挑一条）。 */
const COMMENTARY: Record<TokenTier, readonly string[]> = {
  rookie: [
    '你还有点菜啊，是不是在摸鱼？🐟',
    '这点 token，AI 都快睡着了 😴',
    '就这？就这点量？加把劲啊兄弟',
    '嘿，键盘烫手吗？都没怎么按 🔥',
    '菜得扣脚，今天敲了几个字呀',
    '这点输出，我还以为网断了 📶',
    '省钱小能手是你吧？💰',
    'token 少得我都想给你充点值',
    '这产量…感觉你在带薪发呆 😏',
    '你是不是还没睡醒？☕',
    '连热身都算不上，醒醒 🐣',
    '老板看见这数据要扣鸡腿了 🍗',
  ],
  steady: [
    '还算可以，继续保持 💪',
    '有模有样了，生产力在线',
    '稳定输出，靠谱 💯',
    '这产量，我看好你',
    '中规中矩，保持节奏',
    '老实人实锤了，稳 📊',
    '这个量，AI 都夸你勤快',
    '标准打工人配置，点赞',
    '稳如老狗，我放心了 🐶',
    '这节奏，挺有规律',
    '中流砥柱就是你了',
    '不温不火，恰到好处',
  ],
  titan: [
    '牛逼啊兄弟！今天调用这么多？🚀',
    '大佬受我一拜 🙇',
    '这数据，地球都拦不住你了',
    '究极肝帝，恐怖如斯 😱',
    '这产量，服务器都要喊累了',
    '代码之神降临了吗 ⚡',
    '这 token 量…键盘是砸出来的吧',
    '离谱，太离谱了，给跪 🧎‍♂️',
    '今天是把键盘敲穿了吗 💥',
    '这调用次数，AI 都想罢工了 😵',
    '传说中的生产力怪兽 🐉',
    '牛到没边，请收下我的膝盖',
  ],
}

/**
 * 把今日 token 用量 + 调用次数归入一档。
 *
 * 优先看 token 总量分档；调用次数 ≥ 500 时直通「大佬」档（呼应"调用这么多？"的观感）。
 * token 为 0 时归最低档（实际调用方在 token=0 时不展示文案，此处仅兜底）。
 */
export function resolveTier(totalTokens: number, calls: number): TokenTier {
  // 调用次数爆炸：直通大佬（无视 token 量）。
  if (calls >= TITAN_CALLS_DIRECT) return 'titan'

  if (totalTokens >= TIER_THRESHOLDS.titan) return 'titan'
  if (totalTokens >= TIER_THRESHOLDS.steady) return 'steady'
  return 'rookie'
}

/**
 * 根据 token 用量 + 调用次数挑一句调皮调侃。
 *
 * 返回的短句已含 emoji，可直接拼接到统计行后面。随机源可注入便于单测。
 *
 * @param totalTokens 今日 token 总量（0 时调用方应自行跳过，本函数仍会返回 rookie 档文案）。
 * @param calls       今日调用次数。
 * @param rng         随机源（默认 Math.random），返回 [0,1)。
 * @returns 选中的调侃短句。
 */
export function pickTokenCommentary(
  totalTokens: number,
  calls: number,
  rng: RandomSource = Math.random
): string {
  const tier = resolveTier(totalTokens, calls)
  const pool = COMMENTARY[tier]
  const index = Math.floor(rng() * pool.length)
  // rng() 理论上可能返回 1（极少），floor 后越界，clamp 兜底。
  return pool[Math.min(index, pool.length - 1)]
}
