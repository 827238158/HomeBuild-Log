import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './domainApi'
import { DomainWorkspace } from './DomainWorkspace'

vi.mock('./domainApi', () => ({
  listSources: vi.fn(),
  listRecords: vi.fn(),
  createRecord: vi.fn(),
  getSuggestions: vi.fn(),
  confirmSuggestions: vi.fn(),
  updateRecord: vi.fn(),
  setRecordArchived: vi.fn(),
  listSpaces: vi.fn(),
  createSpace: vi.fn(),
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  listRelations: vi.fn(),
  createRelation: vi.fn(),
  removeRelation: vi.fn(),
}))

const source = {
  id: 'source-1',
  project_id: 'project-1',
  original_text: '主卧门口地砖有一处破裂',
  captured_at: '2026-06-28T10:00:00+08:00',
}

beforeEach(() => {
  vi.mocked(api.listSources).mockResolvedValue([source])
  vi.mocked(api.listRecords).mockResolvedValue([])
  vi.mocked(api.listSpaces).mockResolvedValue([])
  vi.mocked(api.listEntities).mockResolvedValue([])
  vi.mocked(api.listRelations).mockResolvedValue([])
  vi.mocked(api.getSuggestions).mockResolvedValue({
    source_id: source.id,
    engine: 'local-rule-v1',
    relations: [],
    suggestions: [{
      key: 'issue:1', record_type: 'issue', type_label: '施工问题',
      summary: '主卧门口地砖有一处破裂', evidence: source.original_text,
      certainty: 'explicit', certainty_label: '明确', selected_by_default: true,
      payload: {
        record_type: 'issue', title: '地砖破裂', status: 'open',
        phenomenon: '主卧门口地砖有一处破裂', source_refs: [{ source_id: source.id }],
      },
      missing_fields: [], confirmed_record_id: null,
    }],
  })
  vi.mocked(api.confirmSuggestions).mockResolvedValue({ records: [] })
  vi.mocked(api.createRecord).mockResolvedValue({
    id: 'todo-1', record_type: 'todo', title: '现场复核', status: 'pending',
    description: null, archived_at: null, source_refs: [{ source_id: source.id, evidence_excerpt: source.original_text }],
  })
})

describe('DomainWorkspace', () => {
  it('默认勾选明确建议并批量确认', async () => {
    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('施工问题：主卧门口地砖有一处破裂')).toBeTruthy()
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.change(screen.getAllByText('标题')[0].closest('label')!.querySelector('input')!, {
      target: { value: '主卧地砖破裂' },
    })
    fireEvent.click(screen.getByText('确认所选记录'))

    await waitFor(() => expect(api.confirmSuggestions).toHaveBeenCalled())
    expect(vi.mocked(api.confirmSuggestions).mock.calls[0][1][0]).toMatchObject({
      key: 'issue:1', payload: { title: '主卧地砖破裂' },
    })
  })

  it('不确定建议默认不勾选且高级手工录入折叠', async () => {
    vi.mocked(api.getSuggestions).mockResolvedValue({
      source_id: source.id, engine: 'local-rule-v1', relations: [], suggestions: [{
        key: 'research:1', record_type: 'research', type_label: '调研',
        summary: '是否更换地砖', evidence: '是否更换地砖', certainty: 'uncertain',
        certainty_label: '不确定', selected_by_default: false, payload: {}, missing_fields: ['结论'],
      }],
    })
    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('信息不够明确，默认未勾选，请确认后再选择。')).toBeTruthy()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByText('高级手工录入').closest('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('批量确认失败时保留勾选和编辑内容', async () => {
    vi.mocked(api.confirmSuggestions).mockRejectedValue(new Error('整批未保存'))
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('施工问题：主卧门口地砖有一处破裂')
    const titleInput = screen.getAllByText('标题')[0].closest('label')!.querySelector('input')!
    fireEvent.change(titleInput, { target: { value: '保留这个标题' } })
    fireEvent.click(screen.getByText('确认所选记录'))

    expect(await screen.findByText('整批未保存')).toBeTruthy()
    expect((titleInput as HTMLInputElement).value).toBe('保留这个标题')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('从原始来源创建可追溯的待办记录', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    expect(await screen.findByText(source.original_text)).toBeTruthy()

    fireEvent.change(screen.getByText('记录类型').closest('label')!.querySelector('select')!, {
      target: { value: 'todo' },
    })
    fireEvent.change(screen.getAllByText('标题').at(-1)!.closest('label')!.querySelector('input')!, {
      target: { value: '现场复核' },
    })
    fireEvent.change(screen.getByText('待办动作').closest('label')!.querySelector('input')!, {
      target: { value: '等待门套施工后复核' },
    })
    fireEvent.click(screen.getByText('创建正式记录'))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(vi.mocked(api.createRecord).mock.calls[0][0]).toMatchObject({
      record_type: 'todo',
      title: '现场复核',
      source_refs: [{ source_id: source.id, evidence_excerpt: source.original_text }],
      action: '等待门套施工后复核',
    })
  })

  it('可以归档来源下的正式记录', async () => {
    const record = {
      id: 'event-1', record_type: 'event', title: '现场查看', status: 'occurred',
      description: null, archived_at: null, source_refs: [{ source_id: source.id, evidence_excerpt: null }],
    }
    vi.mocked(api.listRecords).mockResolvedValue([record])
    vi.mocked(api.setRecordArchived).mockResolvedValue({ ...record, archived_at: '2026-06-28' })

    render(<DomainWorkspace refreshKey={0} />)
    fireEvent.click(await screen.findByText('归档'))

    await waitFor(() => expect(api.setRecordArchived).toHaveBeenCalledWith('event-1', true))
  })
})
