import { describe, expect, it } from 'vitest'

import { recordStatusDescription, recordStatusLabel } from './recordLabels'

describe('record labels', () => {
  it('区分决策和待办的 pending 语义', () => {
    expect(recordStatusLabel('decision', 'pending')).toBe('待确认')
    expect(recordStatusDescription('decision', 'pending')).toBe('这个决定还没有最终确定。')
    expect(recordStatusLabel('todo', 'pending')).toBe('待处理')
    expect(recordStatusDescription('todo', 'pending')).toBe('这项待办还没有开始处理。')
  })
})
