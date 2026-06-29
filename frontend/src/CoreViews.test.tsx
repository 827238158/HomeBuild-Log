import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './domainApi'
import { CoreViews } from './CoreViews'
import type { ProjectionRecord } from './domainApi'

vi.mock('./domainApi', () => ({
  getTimeline: vi.fn(),
  getLedgerSummary: vi.fn(),
  getIssueBoard: vi.fn(),
  getSpaceArchive: vi.fn(),
  searchRecords: vi.fn(),
  listSpaces: vi.fn(),
  listEntities: vi.fn(),
  updateRecord: vi.fn(),
  getRecord: vi.fn(),
  getSource: vi.fn(),
  listRelations: vi.fn(),
  listRecordAudit: vi.fn(),
}))

const record: ProjectionRecord = {
  id: 'event-1',
  record_type: 'event',
  title: '现场查看',
  status: 'occurred',
  description: null,
  archived_at: null,
  source_refs: [{ source_id: 'source-1', evidence_excerpt: '现场查看' }],
  occurred_at: '2026-06-27T10:00:00+08:00',
  time_precision: 'date',
  original_time_text: '6月27日',
  created_at: '2026-06-28T10:00:00+08:00',
  space_ids: [],
  spaces: [],
  material_ids: [],
  materials: [],
  attachment_ids: [],
}

beforeEach(() => {
  vi.mocked(api.listSpaces).mockResolvedValue([])
  vi.mocked(api.listEntities).mockResolvedValue([])
  vi.mocked(api.getTimeline).mockResolvedValue({
    total: 1,
    groups: [{ date_key: '2026-06-27', label: '2026-06-27', items: [{ record, related_records: [] }] }],
  })
  vi.mocked(api.getLedgerSummary).mockResolvedValue({
    totals_by_currency: [{
      currency: 'CNY', procurement_total_minor: 110000, expense_minor: 50000,
      refund_minor: 0, net_paid_minor: 50000, outstanding_minor: 60000,
      overpaid_minor: 0, unallocated_expense_minor: 0, unallocated_refund_minor: 0,
    }],
    procurements: [], ledger_entries: [], warnings: [],
  })
  vi.mocked(api.getIssueBoard).mockResolvedValue({
    total: 1,
    columns: [
      { status: 'open', label: '发现', items: [{ ...record, id: 'issue-1', record_type: 'issue', title: '地砖破裂', status: 'open', phenomenon: '小破裂' }] },
      { status: 'in_progress', label: '处理中', items: [] },
      { status: 'waiting', label: '等待', items: [] },
      { status: 'resolved', label: '已解决', items: [] },
      { status: 'closed', label: '已关闭', items: [] },
    ],
  })
  vi.mocked(api.updateRecord).mockResolvedValue({ ...record, record_type: 'issue', status: 'waiting' })
  vi.mocked(api.searchRecords).mockResolvedValue({
    query: '现场', counts: { sources: 1, records: 1, materials: 0, vendors: 0, spaces: 0 },
    groups: {
      sources: [{ id: 'source-1', original_text: '现场查看', captured_at: '2026-06-28T10:00:00+08:00' }],
      records: [record], materials: [], vendors: [], spaces: [],
    },
    limit: 20, offset: 0,
  })
  vi.mocked(api.getRecord).mockResolvedValue(record)
  vi.mocked(api.listRelations).mockResolvedValue([])
  vi.mocked(api.listRecordAudit).mockResolvedValue([])
  vi.mocked(api.getSource).mockResolvedValue({
    id: 'source-1', project_id: 'project-1', input_type: 'text', original_text: '现场查看',
    captured_at: '2026-06-28T10:00:00+08:00', reported_time_text: null, attachments: [],
  })
})

describe('CoreViews', () => {
  it('在录入与时间线之间导航，并能打开可追溯详情', async () => {
    render(<CoreViews><p>录入工作台</p></CoreViews>)
    expect(screen.getByText('录入工作台')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    expect(await screen.findByText('装修时间线')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))

    expect(await screen.findByRole('heading', { name: '记录详情' })).toBeTruthy()
    expect(screen.getByText('原始来源与附件')).toBeTruthy()
    expect(api.getSource).toHaveBeenCalledWith('source-1')
  })

  it('记录详情使用中文关系名称', async () => {
    const procurement = { ...record, id: 'procurement-1', record_type: 'procurement', title: '花砖采购' }
    vi.mocked(api.listRelations).mockResolvedValue([{
      id: 'relation-1', from_record_id: record.id, to_record_id: procurement.id, relation_type: 'produces',
    }])
    vi.mocked(api.getRecord).mockImplementation(async (id) => id === procurement.id ? procurement : record)

    render(<CoreViews><p>录入工作台</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(await screen.findByRole('button', { name: /现场查看/ }))

    expect(await screen.findByText('产生 · 花砖采购')).toBeTruthy()
    expect(screen.queryByText(/produces/)).toBeNull()
  })

  it('账本明确展示采购、支出和待付', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '账本' }))

    expect(await screen.findByText('¥1,100.00')).toBeTruthy()
    expect(screen.getByText('¥500.00')).toBeTruthy()
    expect(screen.getByText('¥600.00')).toBeTruthy()
  })

  it('问题状态更新只提交问题记录类型和新状态', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '问题' }))
    const statusSelect = await screen.findByLabelText('处理状态')
    fireEvent.change(statusSelect, { target: { value: 'waiting' } })

    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith(
      'issue-1', { record_type: 'issue', status: 'waiting' },
    ))
  })

  it('基础搜索返回正式记录和原始来源', async () => {
    render(<CoreViews><p>录入</p></CoreViews>)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.change(screen.getByPlaceholderText('例如：花砖、主卧、门套'), {
      target: { value: '现场' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '搜索' }).at(-1)!)

    expect(await screen.findByText('正式记录 · 1')).toBeTruthy()
    expect(screen.getByText('原始来源 · 1')).toBeTruthy()
    expect(api.searchRecords).toHaveBeenCalledWith(expect.objectContaining({ q: '现场' }))
  })
})
