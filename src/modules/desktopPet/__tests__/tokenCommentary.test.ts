import { describe, expect, it } from 'vitest'

import { pickTokenCommentary, resolveTier } from '../tokenCommentary'

// 覆盖：档位判定阈值边界、调用次数直通大佬、随机选句落在对应档池内、rng 越界兜底。
// 文案用「池中包含」断言而非硬编码，避免文案微调导致测试脆裂。

/** 固定返回值的 rng（返回 [0,1) 内的定值），使选句确定。 */
function constRng(v: number): () => number {
  return () => v
}

describe('resolveTier', () => {
  it('classifies sub-10m tokens as rookie', () => {
    expect(resolveTier(0, 0)).toBe('rookie')
    expect(resolveTier(9_999_999, 5)).toBe('rookie')
  })

  it('classifies 10m-100m as steady', () => {
    expect(resolveTier(10_000_000, 10)).toBe('steady')
    expect(resolveTier(99_999_999, 20)).toBe('steady')
  })

  it('classifies >=100m tokens as titan', () => {
    expect(resolveTier(100_000_000, 70)).toBe('titan')
    expect(resolveTier(500_000_000, 80)).toBe('titan')
  })

  it('promotes to titan when calls >= 500 regardless of token count', () => {
    expect(resolveTier(500, 500)).toBe('titan')
    expect(resolveTier(0, 800)).toBe('titan')
  })

  it('keeps steady tier when calls < 500 and tokens in steady band', () => {
    // 5000 万 tokens 落在 steady 区间（1000万-1亿），调用 499 次未触发大佬直通。
    expect(resolveTier(50_000_000, 499)).toBe('steady')
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
    const phrase = pickTokenCommentary(200_000_000, 600, constRng(0))
    const hit = TITAN_KW.some((kw) => phrase.includes(kw))
    expect(hit).toBe(true)
  })

  it('picks a steady phrase for mid-range usage', () => {
    const STEADY_KW = ['还算', '可以', '生产力', '稳定', '靠谱', '看好', '中规中矩', '老实人', '勤快', '打工人', '稳如', '中流砥柱']
    const phrase = pickTokenCommentary(30_000_000, 100, constRng(0.5))
    const hit = STEADY_KW.some((kw) => phrase.includes(kw))
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
    const phrase = pickTokenCommentary(150_000_000, 600, constRng(0.999999))
    expect(typeof phrase).toBe('string')
    expect(phrase.length).toBeGreaterThan(0)
  })

  it('promotes low-token-but-high-calls to titan commentary', () => {
    // 调用次数 600 直通大佬档，即便 token 很少。
    const TITAN_KW = ['牛逼', '大佬', '地球', '肝帝', '服务器', '神', '键盘', '离谱', '敲穿', '罢工', '怪兽', '膝盖']
    const phrase = pickTokenCommentary(2_000, 600, constRng(0))
    const hit = TITAN_KW.some((kw) => phrase.includes(kw))
    expect(hit).toBe(true)
  })
})
