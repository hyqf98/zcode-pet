import { describe, expect, it } from 'vitest'

import { pickTokenCommentary, resolveTier } from '../tokenCommentary'

// 覆盖：档位判定阈值边界、调用次数直通大佬、随机选句落在对应档池内、rng 越界兜底。
// 文案用「池中包含」断言而非硬编码，避免文案微调导致测试脆裂。

/** 固定返回值的 rng（返回 [0,1) 内的定值），使选句确定。 */
function constRng(v: number): () => number {
  return () => v
}

describe('resolveTier', () => {
  it('classifies sub-10k tokens as rookie', () => {
    expect(resolveTier(0, 0)).toBe('rookie')
    expect(resolveTier(9_999, 5)).toBe('rookie')
  })

  it('classifies 10k-50k as warming', () => {
    expect(resolveTier(10_000, 10)).toBe('warming')
    expect(resolveTier(49_999, 20)).toBe('warming')
  })

  it('classifies 50k-200k as steady', () => {
    expect(resolveTier(50_000, 30)).toBe('steady')
    expect(resolveTier(199_999, 40)).toBe('steady')
  })

  it('classifies 200k-1m as pro', () => {
    expect(resolveTier(200_000, 50)).toBe('pro')
    expect(resolveTier(999_999, 60)).toBe('pro')
  })

  it('classifies >=1m tokens as titan', () => {
    expect(resolveTier(1_000_000, 70)).toBe('titan')
    expect(resolveTier(50_000_000, 80)).toBe('titan')
  })

  it('promotes to titan when calls >= 100 regardless of token count', () => {
    expect(resolveTier(500, 100)).toBe('titan')
    expect(resolveTier(0, 250)).toBe('titan')
  })

  it('keeps steady tier when calls < 100 and tokens in steady band', () => {
    // 100k tokens 落在 steady 区间（5万-20万），调用 99 次未触发大佬直通。
    expect(resolveTier(100_000, 99)).toBe('steady')
  })
})

describe('pickTokenCommentary', () => {
  it('picks a rookie phrase for tiny usage', () => {
    // 菜鸡档标志性词（不绑定具体索引，文案微调不致测试脆裂）。
    const ROOKIE_KW = ['菜', '摸鱼', '睡着', '就这', '键盘', '网断', '省钱', '充点值', '发呆', '睡醒', '热身', '鸡腿']
    const phrase = pickTokenCommentary(800, 3, constRng(0.5))
    const hit = ROOKIE_KW.some((kw) => phrase.includes(kw))
    expect(hit).toBe(true)
  })

  it('picks a titan phrase for massive usage', () => {
    const TITAN_KW = ['牛逼', '大佬', '地球', '肝帝', '服务器', '神', '键盘', '离谱', '敲穿', '罢工', '怪兽', '膝盖']
    const phrase = pickTokenCommentary(5_000_000, 200, constRng(0))
    const hit = TITAN_KW.some((kw) => phrase.includes(kw))
    expect(hit).toBe(true)
  })

  it('returns different phrases across the pool for varying rng values (rookie tier)', () => {
    // 不同 rng 应能命中池内不同句子（验证不是永远返回同一句）。
    const phrases = new Set<string>()
    for (let i = 0; i < 12; i += 1) {
      phrases.add(pickTokenCommentary(500, 1, constRng(i / 12)))
    }
    expect(phrases.size).toBeGreaterThan(1)
  })

  it('clamps index when rng returns ~1 to avoid out-of-bounds', () => {
    // rng 返回接近 1（理论上不该，但 Math.random 边界）不应抛错。
    const phrase = pickTokenCommentary(1_500_000, 300, constRng(0.999999))
    expect(typeof phrase).toBe('string')
    expect(phrase.length).toBeGreaterThan(0)
  })

  it('promotes low-token-but-high-calls to titan commentary', () => {
    // 调用次数 120 直通大佬档，即便 token 很少。
    const TITAN_KW = ['牛逼', '大佬', '地球', '肝帝', '服务器', '神', '键盘', '离谱', '敲穿', '罢工', '怪兽', '膝盖']
    const phrase = pickTokenCommentary(2_000, 120, constRng(0))
    const hit = TITAN_KW.some((kw) => phrase.includes(kw))
    expect(hit).toBe(true)
  })
})
