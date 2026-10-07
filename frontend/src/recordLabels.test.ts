import { describe, expect, it } from 'vitest'

import { recordStatusDescription, recordStatusLabel, recordTypeLabels } from './recordLabels'

describe('record labels', () => {
  it('区分行动事项与调研主题并统一调研进度名称', () => {
    expect(recordTypeLabels.issue).toBe('待办与问题')
    expect(recordStatusLabel('research', 'collecting')).toBe('待调研')
    expect(recordStatusLabel('research', 'comparing')).toBe('调研中')
    expect(recordStatusLabel('research', 'concluded')).toBe('调研中')
  })
  it('区分决策和问题的 pending 语义', () => {
    expect(recordStatusLabel('decision', 'pending')).toBe('待确认')
    expect(recordStatusDescription('decision', 'pending')).toBe('这个决定还没有最终确定。')
    expect(recordStatusLabel('issue', 'pending')).toBe('待处理')
    expect(recordStatusLabel('ledger', 'paid')).toBe('已出账')
    expect(recordStatusLabel('ledger', 'posted', 'refund')).toBe('已入账')
    expect(recordStatusDescription('issue', 'pending')).toBe('这个问题还没有开始处理。')
  })
})
