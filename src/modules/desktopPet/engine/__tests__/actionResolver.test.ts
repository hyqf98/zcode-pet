import { describe, expect, it } from 'vitest'

import { resolveAction } from '../actionResolver'

describe('resolveAction', () => {
  it('returns the original action in free mode', () => {
    expect(resolveAction('running', 'free')).toBe('running')
    expect(resolveAction('idle', 'free')).toBe('idle')
    expect(resolveAction('waving', 'free')).toBe('waving')
  })

  it('downgrades running to idle in fixed mode', () => {
    expect(resolveAction('running', 'fixed')).toBe('idle')
  })

  it('keeps non-running actions unchanged in fixed mode', () => {
    expect(resolveAction('idle', 'fixed')).toBe('idle')
    expect(resolveAction('waving', 'fixed')).toBe('waving')
    expect(resolveAction('jumping', 'fixed')).toBe('jumping')
    expect(resolveAction('failed', 'fixed')).toBe('failed')
    expect(resolveAction('waiting', 'fixed')).toBe('waiting')
    expect(resolveAction('review', 'fixed')).toBe('review')
  })
})
