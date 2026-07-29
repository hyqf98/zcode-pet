import { describe, expect, it } from 'vitest'

import { mapEvent } from '../eventMapper'

// 覆盖 7 类事件的映射、辅助函数行为（basename / 首行截断 / 错误截断）以及未知事件。

describe('mapEvent', () => {
  it('maps SessionStart to waving greet (info)', () => {
    const spec = mapEvent({ event: 'SessionStart', source: 'startup' })

    expect(spec).not.toBeNull()
    expect(spec!.action).toBe('waving')
    expect(spec!.messageKey).toBe('notif.session.greet')
    expect(spec!.severity).toBe('info')
    expect(spec!.instant).toBeFalsy()
    expect(spec!.params).toBeUndefined()
    expect(spec!.minDisplayMs).toBe(2200)
  })

  it('maps UserPromptSubmit to waiting thinking (info)', () => {
    const spec = mapEvent({ event: 'UserPromptSubmit', prompt: '帮我写个函数' })

    expect(spec).not.toBeNull()
    expect(spec!.action).toBe('waiting')
    expect(spec!.messageKey).toBe('notif.user.thinking')
    expect(spec!.severity).toBe('info')
    expect(spec!.params).toBeUndefined()
  })

  it('maps PreToolUse Write with filePath to verb-specific write key + basename', () => {
    const spec = mapEvent({
      event: 'PreToolUse',
      toolName: 'Write',
      filePath: 'src/a/b.ts',
    })

    expect(spec).not.toBeNull()
    expect(spec!.action).toBe('running')
    expect(spec!.messageKey).toBe('notif.tool.write')
    expect(spec!.severity).toBe('info')
    expect(spec!.params).toEqual({ file: 'b.ts' })
  })

  it('maps PreToolUse Read to notif.tool.read key', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Read', filePath: 'src/x.ts' })
    expect(spec!.messageKey).toBe('notif.tool.read')
    expect(spec!.params).toEqual({ file: 'x.ts' })
  })

  it('maps PreToolUse Edit to notif.tool.edit key', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Edit', filePath: 'src/y.ts' })
    expect(spec!.messageKey).toBe('notif.tool.edit')
    expect(spec!.params).toEqual({ file: 'y.ts' })
  })

  it('maps PreToolUse Bash to notif.tool.bash with command', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Bash', command: 'cargo build --release' })
    expect(spec!.messageKey).toBe('notif.tool.bash')
    expect(spec!.params).toEqual({ command: 'cargo build --release' })
  })

  it('maps PreToolUse Bash with very long command truncated to 40 chars + ellipsis', () => {
    const long = 'x'.repeat(120)
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Bash', command: long })
    expect(spec!.params!.command.length).toBe(40)
    expect(spec!.params!.command.endsWith('…')).toBe(true)
  })

  it('maps PreToolUse Grep to notif.tool.search with pattern', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Grep', pattern: 'handleClick' })
    expect(spec!.messageKey).toBe('notif.tool.search')
    expect(spec!.params).toEqual({ pattern: 'handleClick' })
  })

  it('maps PreToolUse Task (subagent) to notif.tool.subagent with description', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Task', description: 'explore codebase' })
    expect(spec!.messageKey).toBe('notif.tool.subagent')
    expect(spec!.params).toEqual({ desc: 'explore codebase' })
  })

  it('maps PreToolUse Task without description to generic subagent key', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'Task' })
    expect(spec!.messageKey).toBe('notif.tool.subagent.generic')
    expect(spec!.params).toBeUndefined()
  })

  it('maps PreToolUse WebFetch with url', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'WebFetch', url: 'https://example.com/api' })
    expect(spec!.messageKey).toBe('notif.tool.webfetch')
    expect(spec!.params).toEqual({ url: 'https://example.com/api' })
  })

  it('maps PreToolUse without known tool/file to generic start key', () => {
    const spec = mapEvent({ event: 'PreToolUse', toolName: 'SomeUnknownTool' })
    expect(spec!.messageKey).toBe('notif.tool.start')
    expect(spec!.params).toEqual({ tool: 'SomeUnknownTool' })
  })

  it('maps PreToolUse without toolName but with filePath to generic start.file fallback', () => {
    const spec = mapEvent({ event: 'PreToolUse', filePath: 'src\\a\\b.ts' })
    expect(spec!.params).toEqual({ tool: '工具', file: 'b.ts' })
  })

  it('maps PostToolUse for file tool (Edit) to done.file with basename', () => {
    const spec = mapEvent({ event: 'PostToolUse', toolName: 'Edit', filePath: 'src/a/b.ts' })
    expect(spec!.action).toBe('review')
    expect(spec!.messageKey).toBe('notif.tool.done.file')
    expect(spec!.severity).toBe('success')
    expect(spec!.params).toEqual({ tool: 'Edit', file: 'b.ts' })
  })

  it('maps PostToolUse for non-file tool to generic done key', () => {
    const spec = mapEvent({ event: 'PostToolUse', toolName: 'Bash' })
    expect(spec!.messageKey).toBe('notif.tool.done')
    expect(spec!.params).toEqual({ tool: 'Bash' })
  })

  it('maps PostToolUseFailure to failed (error, instant)', () => {
    const spec = mapEvent({
      event: 'PostToolUseFailure',
      toolName: 'Write',
      error: 'disk full',
    })

    expect(spec!.action).toBe('failed')
    expect(spec!.messageKey).toBe('notif.tool.failed')
    expect(spec!.severity).toBe('error')
    expect(spec!.instant).toBe(true)
    expect(spec!.params).toEqual({ tool: 'Write', error: 'disk full' })
  })

  it('truncates PostToolUseFailure error to <=80 chars and defaults when missing', () => {
    const longError = 'x'.repeat(200)
    const truncated = mapEvent({
      event: 'PostToolUseFailure',
      toolName: 'Write',
      error: longError,
    })

    expect(truncated!.params!.error).toHaveLength(80)
    expect(truncated!.params!.error).toBe('x'.repeat(80))

    const defaulted = mapEvent({ event: 'PostToolUseFailure' })
    expect(defaulted!.params!.error).toBe('未知错误')
    expect(defaulted!.params!.tool).toBe('工具')
    expect(defaulted!.instant).toBe(true)
  })

  it('maps PermissionRequest to jumping perm.need (warn)', () => {
    const spec = mapEvent({ event: 'PermissionRequest', toolName: 'Bash' })

    expect(spec!.action).toBe('jumping')
    expect(spec!.messageKey).toBe('notif.perm.need')
    expect(spec!.severity).toBe('warn')
    expect(spec!.params).toEqual({ tool: 'Bash' })
  })

  it('maps Stop without lastAssistantMessage to failed action (abnormal end)', () => {
    const spec = mapEvent({ event: 'Stop' })

    expect(spec!.action).toBe('failed')
    expect(spec!.messageKey).toBe('notif.stop.empty')
    expect(spec!.severity).toBe('warn')
    expect(spec!.fullText).toBeUndefined()
  })

  it('maps Stop with lastAssistantMessage to fullText for SSE rendering', () => {
    const spec = mapEvent({
      event: 'Stop',
      lastAssistantMessage: '我已经完成了重构，修改了 3 个文件。',
    })

    expect(spec!.fullText).toBe('我已经完成了重构，修改了 3 个文件。')
    expect(spec!.action).toBe('waving')
  })

  it('truncates Stop fullText to <=120 chars with ellipsis', () => {
    const long = 'a'.repeat(200)
    const spec = mapEvent({ event: 'Stop', lastAssistantMessage: long })

    expect(spec!.fullText).toHaveLength(121) // 120 + '…'
    expect(spec!.fullText!.endsWith('…')).toBe(true)
  })

  it('drops Stop fullText when message is empty or whitespace', () => {
    expect(
      mapEvent({ event: 'Stop', lastAssistantMessage: '   ' })!.fullText
    ).toBeUndefined()
    expect(
      mapEvent({ event: 'Stop', lastAssistantMessage: '' })!.fullText
    ).toBeUndefined()
  })

  it('returns null for unknown events', () => {
    expect(mapEvent({ event: 'Whatever' })).toBeNull()
    expect(mapEvent({ event: '' })).toBeNull()
  })
})
