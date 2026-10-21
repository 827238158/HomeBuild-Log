import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { associationRecordOptions, RecordAssociations, requiredRecordContextError, useAssociationOptions } from './RecordAssociations'
import type { DomainRecord } from './domainApi'
import * as api from './domainApi'

const entities = { spaces: [{ id: 's', name: '客厅' }], materials: [], participants: [], stages: [] }
const record = (id: string, title: string, topic_ids: string[] = []): DomainRecord => ({ id, title, topic_ids, record_type: 'research', status: 'collecting', description: null, archived_at: null, source_refs: [] })

describe('RecordAssociations', () => {
  it('创建背景校验只检查必填，实际ID有效性交给服务端', () => {
    expect(requiredRecordContextError({})).toBe('请选择至少一个空间')
    expect(requiredRecordContextError({ space_ids: [' ', null] })).toBe('请选择至少一个空间')
    expect(requiredRecordContextError({ space_ids: ['space'], stage_id: ' ' })).toBe('请选择装修阶段')
    expect(requiredRecordContextError({ space_ids: ['space'], stage_id: 'stage' })).toBe('')
  })
  it('必填空间和阶段常显，读取失败就近重试，错误聚焦不展开可选区', async () => {
    const retry = vi.fn()
    const props = { requireContext: true, payload: {}, onChange: vi.fn(), entities: { ...entities, stages: [{ id: 'stage', name: '安装' }] }, records: [] }
    const { rerender } = render(<RecordAssociations {...props} loading />)
    expect(screen.getByRole('status').textContent).toContain('正在读取')
    expect((screen.getByRole('button', { name: /^空间：/ }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<RecordAssociations {...props} optionsError="背景读取失败" onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toContain('背景读取失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce()
    rerender(<RecordAssociations {...props} error="请选择至少一个空间" />)
    const spaces = screen.getByRole('button', { name: /^空间：/ })
    await waitFor(() => expect(document.activeElement).toBe(spaces))
    expect(screen.getByRole('button', { name: /更多信息与关联/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /^材料：/ })).toBeNull()
    fireEvent.click(spaces)
    expect(screen.getByRole('listbox', { name: '空间' }).getAttribute('aria-required')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    rerender(<RecordAssociations {...props} error="请选择装修阶段" />)
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('装修阶段：未选择'))
    expect(screen.getByRole('combobox', { name: /^装修阶段：/ }).getAttribute('aria-required')).toBe('true')
  })
  it('同主题优先且保持分组原序，去重并排除自身', () => {
    const rows = [record('a', '其他'), record('b', '主题甲', ['t']), record('self', '当前', ['t']), record('b', '重复', ['t']), record('c', '主题乙', ['u']), record('d', '其他乙')]
    expect(associationRecordOptions(rows, ['t', 'u'], 'self').map(item => item.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(associationRecordOptions(rows, [], 'self').map(item => item.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('默认折叠，搜索全项目；收起或更换主题保留选择', () => {
    function Fixture() {
      const [payload, setPayload] = useState<Record<string, unknown>>({ space_ids: ['s'], topic_ids: ['t'], related_record_ids: ['a'] })
      return <><button onClick={() => setPayload(value => ({ ...value, topic_ids: [] }))}>清空主题</button><RecordAssociations payload={payload} onChange={(key, value) => setPayload(previous => ({ ...previous, [key]: value }))} entities={entities} records={[record('a', '其他'), record('b', '主题', ['t'])]} /><output>{JSON.stringify(payload)}</output></>
    }
    render(<Fixture />)
    expect(screen.getByRole('button', { name: /更多信息与关联/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /更多信息与关联/ }))
    fireEvent.click(screen.getByRole('button', { name: /关联记录/ }))
    expect(screen.getByRole('listbox', { name: '关联记录（可选）' }).parentElement).toBe(document.body)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '其他' } })
    expect((screen.getByRole('checkbox', { name: '调研 · 其他' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: '调研 · 主题' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /更多信息与关联/ }))
    fireEvent.click(screen.getByText('清空主题'))
    expect(screen.getByRole('status').textContent).toContain('"related_record_ids":["a"]')
  })
  it('只对高级字段错误展开，并聚焦对应字段而非第一个字段', async () => {
    const props = { payload: {}, onChange: () => {}, entities: { ...entities, materials: [{ id: 'm', name: '木材' }] }, records: [] }
    const { rerender } = render(<RecordAssociations {...props} error="金额不能为空" />)
    expect(screen.getByRole('button', { name: /更多信息与关联/ }).getAttribute('aria-expanded')).toBe('false')
    rerender(<RecordAssociations {...props} error="material_ids 无效" />)
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('材料：请选择（可多选）'))
    expect(screen.queryByText('material_ids 无效')).toBeNull()
  })
  it('历史编辑背景常显且不强制必填，读取失败可就近重试并保留选择', async () => {
    const retry = vi.fn()
    const { rerender } = render(<RecordAssociations payload={{ related_record_ids: ['missing'] }} onChange={() => {}} entities={entities} records={[]} />)
    expect(screen.getByRole('button', { name: /^空间：/ })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /^装修阶段：/ }).getAttribute('aria-required')).toBe('false')
    expect(screen.queryByText('（必填）')).toBeNull()
    rerender(<RecordAssociations payload={{ related_record_ids: ['missing'] }} onChange={() => {}} entities={entities} records={[]} error="空间无效" optionsError="读取失败" onRetry={retry} />)
    expect((screen.getByRole('button', { name: /^空间：/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /更多信息与关联/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /更多信息与关联/ }))
    expect((screen.getByRole('button', { name: /关联记录（可选）：已选择 1 项/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('重试'))
    expect(retry).toHaveBeenCalledOnce()
  })
  it('读取失败保留选项，重试后恢复', async () => {
    vi.spyOn(api, 'listSpaces').mockResolvedValue([])
    vi.spyOn(api, 'listEntities').mockResolvedValue([])
    const list = vi.spyOn(api, 'listRecords').mockRejectedValueOnce(new Error('无法读取')).mockResolvedValueOnce([record('a', '已读取')])
    function Fixture() { const options = useAssociationOptions(); return <><p>{options.error || options.records[0]?.title}</p><button onClick={options.retry}>重新读取</button></> }
    render(<Fixture />)
    await screen.findByText('无法读取')
    fireEvent.click(screen.getByText('重新读取'))
    await screen.findByText('已读取')
    expect(list).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })
})
