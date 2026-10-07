import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecordDetail } from './RecordDetail'
import * as api from './domainApi'
import { beijingToday } from './time'

vi.mock('./domainApi', () => ({ getRecord: vi.fn(), getSource: vi.fn(), listRelations: vi.fn(), listRecordAudit: vi.fn(), listSpaces: vi.fn(), listRecords: vi.fn(), listEntities: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), deleteRecord: vi.fn(), reviewRecordSource: vi.fn() }))
vi.mock('./DomainWorkspace', async importOriginal => {
  const original = await importOriginal<typeof import('./DomainWorkspace')>()
  return { ...original, RecordEditFields: ({ payload, onChange }: { payload: Record<string, unknown>; onChange: (field: string, value: unknown) => void }) => <><output data-testid="draft">{JSON.stringify(payload)}</output><button onClick={() => onChange('values', [{ axis: '净宽', value: 898, unit: 'mm' }])}>输入新尺寸</button></> }
})
const record = { id: 'old', record_type: 'measurement', title: '门洞', status: 'active', description: '旧说明', occurred_date: '2020-01-01', original_time_text: null, created_at: '2020-01-01T00:00:00Z', object_name: '厨房门洞', measurement_role: 'site_measurement', values: [{ axis: '净宽', value: 900, unit: 'mm' }], measured_at: '2020-01-01T00:00:00Z', method: '卷尺', approximate: true, tolerance_text: '完成面', source_refs: [{ source_id: 'source', source_revision: 1, evidence_excerpt: null, needs_review: false }], archived_at: null, space_ids: ['kitchen'], material_ids: ['wood'], participant_ids: [], spaces: [], materials: [], participants: [], attachment_ids: [], stage_id: 'tile' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getRecord).mockResolvedValue(record)
  vi.mocked(api.getSource).mockResolvedValue({ id: 'source', project_id: 'project', input_type: 'text', original_text: '旧来源', attachments: [], captured_at: '2020-01-01', reported_time_text: null, updated_at: '2020-01-01', revision: 1 })
  vi.mocked(api.listRelations).mockResolvedValue([]); vi.mocked(api.listRecordAudit).mockResolvedValue([])
  vi.mocked(api.listSpaces).mockResolvedValue([]); vi.mocked(api.listRecords).mockResolvedValue([]); vi.mocked(api.listEntities).mockResolvedValue([])
})
afterEach(cleanup)
it('调研详情保留继续调研入口并隐藏旧结论', async () => {
  vi.mocked(api.getRecord).mockResolvedValue({ ...record, record_type: 'research', conclusion: '旧结论', status: 'concluded' })
  const onOpenResearch = vi.fn()
  render(<RecordDetail recordId="old" closing={false} onClose={vi.fn()} onChanged={vi.fn()} onExitComplete={vi.fn()} onOpen={vi.fn()} onOpenSource={vi.fn()} onOpenResearch={onOpenResearch} />)
  fireEvent.click(await screen.findByRole('button', { name: '继续调研' }))
  expect(onOpenResearch).toHaveBeenCalledWith('old')
  expect(screen.queryByText('旧结论')).toBeNull()
  expect(screen.queryByText('当前结论')).toBeNull()
  expect(screen.getByText('调研中')).toBeTruthy()
})
it('复测清空旧事实，单次创建关联记录，失败保留草稿且不更新旧记录', async () => {
  const onOpen = vi.fn(), onChanged = vi.fn()
  render(<RecordDetail recordId="old" closing={false} onClose={vi.fn()} onChanged={onChanged} onExitComplete={vi.fn()} onOpen={onOpen} onOpenSource={vi.fn()} onOpenResearch={vi.fn()} />)
  expect(await screen.findByText('近似值／粗测')).toBeTruthy()
  expect(screen.getByText('完成面')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '再次测量' }))
  const draft = JSON.parse((await screen.findByTestId('draft')).textContent!)
  expect(draft.values).toEqual([{ axis: '净宽', value: null, unit: 'mm' }])
  expect(draft.source_refs).toEqual([]); expect(draft.description).toBeNull(); expect(draft.method).toBeNull()
  expect(draft.space_ids).toEqual(['kitchen']); expect(draft.material_ids).toEqual(['wood']); expect(draft.stage_id).toBe('tile')
  expect(draft.occurred_date).toBe(beijingToday()); expect(draft.measured_at).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: '保存本次测量' })).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button', { name: '保存本次测量' }))
  expect((await screen.findByRole('alert')).textContent).toContain('请至少填写一项本次测量的数值')
  expect(api.createRecord).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '输入新尺寸' }))
  vi.mocked(api.createRecord).mockRejectedValueOnce(new Error('保存失败'))
  fireEvent.click(screen.getByRole('button', { name: '保存本次测量' }))
  expect((await screen.findByRole('alert')).textContent).toContain('保存失败')
  expect(screen.getByTestId('draft').textContent).toContain('898')
  vi.mocked(api.createRecord).mockResolvedValueOnce({ ...record, id: 'new' })
  fireEvent.click(screen.getByRole('button', { name: '保存本次测量' }))
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new'))
  expect(api.createRecord).toHaveBeenLastCalledWith(expect.objectContaining({ related_record_ids: ['old'], source_refs: [], values: [{ axis: '净宽', value: 898, unit: 'mm' }] }))
  expect(api.updateRecord).not.toHaveBeenCalled(); expect(onChanged).toHaveBeenCalledOnce()
})
it('取消复测不写入记录也不更改旧来源', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<RecordDetail recordId="old" closing={false} onClose={vi.fn()} onChanged={vi.fn()} onExitComplete={vi.fn()} onOpen={vi.fn()} onOpenSource={vi.fn()} onOpenResearch={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '再次测量' }))
  await screen.findByTestId('draft')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.queryByTestId('draft')).toBeNull()
  expect(api.createRecord).not.toHaveBeenCalled(); expect(api.updateRecord).not.toHaveBeenCalled()
  expect(await screen.findByText('旧来源')).toBeTruthy()
  confirm.mockRestore()
})
