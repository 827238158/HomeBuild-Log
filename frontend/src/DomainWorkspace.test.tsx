import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './domainApi'
import { DomainWorkspace } from './DomainWorkspace'

vi.mock('./domainApi', () => ({
  listSources: vi.fn(),
  listRecords: vi.fn(),
  createRecord: vi.fn(),
  getLatestCandidateBundle: vi.fn(),
  createExtraction: vi.fn(),
  confirmCandidateBundle: vi.fn(),
  updateRecord: vi.fn(),
  setRecordArchived: vi.fn(),
  listSpaces: vi.fn(),
  createSpace: vi.fn(),
  deleteSpace: vi.fn(),
  listEntities: vi.fn(),
  createEntity: vi.fn(),
  deleteEntity: vi.fn(),
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

const explicitBundle = {
  id: 'bundle-1', source_id: source.id, extraction_run_id: 'run-1', request_id: 'request-1',
  requested_engine: 'auto' as const, engine: 'local-rule-v1', fallback_reason: null,
  status: 'pending' as const, version: 1, created_at: '2026-06-29T10:00:00+08:00',
  updated_at: '2026-06-29T10:00:00+08:00', relations: [], questions: [], warnings: [],
  suggestions: [{
    key: 'issue:1', record_type: 'issue', type_label: '施工问题',
    summary: '主卧门口地砖有一处破裂', evidence: source.original_text,
    certainty: 'explicit' as const, certainty_label: '明确', selected_by_default: true,
    payload: {
      record_type: 'issue', title: '地砖破裂', status: 'open',
      phenomenon: '主卧门口地砖有一处破裂', source_refs: [{ source_id: source.id }],
    },
    missing_fields: [], review_state: 'active' as const, deferred_at: null,
    confirmed_record_id: null,
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listSources).mockResolvedValue([source])
  vi.mocked(api.listRecords).mockResolvedValue([])
  vi.mocked(api.listSpaces).mockResolvedValue([])
  vi.mocked(api.listEntities).mockResolvedValue([])
  vi.mocked(api.listRelations).mockResolvedValue([])
  vi.mocked(api.getLatestCandidateBundle).mockResolvedValue(explicitBundle)
  vi.mocked(api.createExtraction).mockResolvedValue(explicitBundle)
  vi.mocked(api.confirmCandidateBundle).mockResolvedValue({
    records: [], bundle: explicitBundle,
  })
  vi.mocked(api.createRecord).mockResolvedValue({
    id: 'todo-1', record_type: 'todo', title: '现场复核', status: 'pending',
    description: null, archived_at: null, source_refs: [{ source_id: source.id, evidence_excerpt: source.original_text }],
  })
})

describe('DomainWorkspace', () => {
  it('默认勾选明确建议并批量确认', async () => {
    render(<DomainWorkspace refreshKey={0} />)

    expect(screen.getByRole('heading', { name: 'AI 录入' })).toBeTruthy()
    expect(await screen.findByText('施工问题：主卧门口地砖有一处破裂')).toBeTruthy()
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.change(screen.getAllByText('标题')[0].closest('label')!.querySelector('input')!, {
      target: { value: '主卧地砖破裂' },
    })
    fireEvent.click(screen.getByText('确认所选'))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(vi.mocked(api.confirmCandidateBundle).mock.calls[0][2][0]).toMatchObject({
      key: 'issue:1', payload: { title: '主卧地砖破裂' },
    })
  })

  it('不确定建议默认也会勾选且手工录入折叠', async () => {
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle, suggestions: [{
        key: 'research:1', record_type: 'research', type_label: '调研',
        summary: '是否更换地砖', evidence: '是否更换地砖', certainty: 'uncertain',
        certainty_label: '不确定', selected_by_default: false, payload: { title: '调研' }, missing_fields: ['结论'],
        review_state: 'active', deferred_at: null, confirmed_record_id: null,
      }],
    })
    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('调研：是否更换地砖')).toBeTruthy()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByText('手工录入').closest('details') as HTMLDetailsElement).open).toBe(false)
  })

  it('各类手工录入字段显示示例但不会把示例作为值提交', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('施工问题：主卧门口地砖有一处破裂')
    const panel = screen.getByText('手工录入').closest('details')!
    const form = within(panel)
    const typeSelect = form.getByLabelText('记录类型')

    expect(form.getByLabelText('标题')).toHaveProperty('placeholder', '例如：主卧地砖铺贴完成')
    expect(form.getByLabelText('事件类型')).toHaveProperty('placeholder', '例如：现场查看、施工完成或验收')
    expect(form.getByLabelText('补充内容')).toHaveProperty('placeholder', '例如：已完成铺贴并现场验收')

    fireEvent.change(typeSelect, { target: { value: 'ledger' } })
    expect(form.getByLabelText('标题')).toHaveProperty('placeholder', '例如：支付花砖预付款')
    expect(form.getByLabelText('金额（元）')).toHaveProperty('type', 'number')
    expect(form.getByLabelText('金额（元）')).toHaveProperty('value', '')

    fireEvent.change(typeSelect, { target: { value: 'measurement' } })
    expect(form.getByLabelText('宽度（cm）')).toHaveProperty('placeholder', '例如：90')
    expect(form.getByLabelText('高度（cm，可选）')).toHaveProperty('placeholder', '例如：210')

    fireEvent.change(typeSelect, { target: { value: 'decision' } })
    fireEvent.change(form.getByLabelText('标题'), { target: { value: '铺贴方案' } })
    fireEvent.change(form.getByLabelText('决策主题'), { target: { value: '花砖方向' } })
    fireEvent.change(form.getByLabelText('选项（逗号分隔）'), { target: { value: '横贴，竖贴' } })
    fireEvent.click(form.getByText('创建正式记录'))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(vi.mocked(api.createRecord).mock.calls.at(-1)?.[0]).toMatchObject({
      options: ['横贴', '竖贴'],
    })
  })

  it('解释空间上级并可确认删除未使用的空间和共享档案', async () => {
    const house = { id: 'space-house', name: '房屋', kind: 'house', parent_id: null }
    const room = { id: 'space-room', name: '主卧', kind: 'room', parent_id: house.id }
    const material = { id: 'material-1', name: '花砖', brand: '测试品牌' }
    vi.mocked(api.listSpaces).mockResolvedValue([house, room])
    vi.mocked(api.listEntities).mockImplementation(async (type) => type === 'materials' ? [material] : [])
    vi.mocked(api.deleteSpace).mockResolvedValue(undefined)
    vi.mocked(api.deleteEntity).mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<DomainWorkspace refreshKey={0} />)
    expect(await screen.findByText(/用于建立“房屋 → 房间 → 局部构件\/表面”层级/)).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText(/上级空间/)).toHaveProperty('value', house.id))
    expect(screen.getByText('房间 · 上级：房屋')).toBeTruthy()
    expect(screen.getByText('房屋 · 系统根空间')).toBeTruthy()
    expect(screen.getByText('系统根空间不可删除')).toBeTruthy()

    fireEvent.click(within(screen.getByLabelText('已有空间')).getByText('删除'))
    await waitFor(() => expect(api.deleteSpace).toHaveBeenCalledWith(room.id))
    fireEvent.click(within(screen.getByLabelText('已有材料')).getByText('删除'))
    await waitFor(() => expect(api.deleteEntity).toHaveBeenCalledWith('materials', material.id))
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it('新增材料时提交可选品牌并在列表组合展示', async () => {
    const material = { id: 'material-1', name: '花砖', brand: '马可波罗' }
    vi.mocked(api.listEntities).mockImplementation(async (type) => type === 'materials' ? [material] : [])
    vi.mocked(api.createEntity).mockResolvedValue(material)

    render(<DomainWorkspace refreshKey={0} />)
    expect(await screen.findByText('马可波罗 · 花砖')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('材料名称'), { target: { value: '柔光砖' } })
    fireEvent.change(screen.getByLabelText('材料品牌（可选）'), { target: { value: '东鹏' } })
    fireEvent.click(screen.getByText('新增材料'))

    await waitFor(() => expect(api.createEntity).toHaveBeenCalledWith('materials', {
      name: '柔光砖', brand: '东鹏',
    }))
    fireEvent.change(screen.getByLabelText('档案类型'), { target: { value: 'vendors' } })
    expect(screen.queryByLabelText('材料品牌（可选）')).toBeNull()
  })

  it('删除引用中的档案时显示后端冲突原因', async () => {
    const material = { id: 'material-1', name: '花砖' }
    vi.mocked(api.listEntities).mockImplementation(async (type) => type === 'materials' ? [material] : [])
    vi.mocked(api.deleteEntity).mockRejectedValue(new Error('该材料已被正式记录使用，请先解除记录关联。'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('施工问题：主卧门口地砖有一处破裂')
    fireEvent.click(within(screen.getByLabelText('已有材料')).getByText('删除'))

    expect(await screen.findByText('该材料已被正式记录使用，请先解除记录关联。')).toBeTruthy()
    confirm.mockRestore()
  })

  it('用中文说明和预览建立原始枚举关系', async () => {
    const ledger = { id: 'ledger-1', record_type: 'ledger', title: '500 元预付款', status: 'posted', description: null, archived_at: null, source_refs: [] }
    const procurement = { id: 'procurement-1', record_type: 'procurement', title: '花砖采购', status: 'ordered', description: null, archived_at: null, source_refs: [] }
    vi.mocked(api.listRecords).mockResolvedValue([ledger, procurement])
    vi.mocked(api.listRelations).mockResolvedValue([{ id: 'relation-1', from_record_id: ledger.id, to_record_id: procurement.id, relation_type: 'pays_for' }])
    vi.mocked(api.createRelation).mockResolvedValue({ id: 'relation-2', from_record_id: ledger.id, to_record_id: procurement.id, relation_type: 'pays_for' })
    vi.mocked(api.removeRelation).mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('500 元预付款 → 用于支付 → 花砖采购')
    fireEvent.change(screen.getByLabelText('第一条记录'), { target: { value: ledger.id } })
    fireEvent.change(screen.getByLabelText('它与第二条记录的关系'), { target: { value: 'pays_for' } })
    fireEvent.change(screen.getByLabelText('第二条记录'), { target: { value: procurement.id } })

    expect(screen.getByText(/账目 · 500 元预付款 → 用于支付 → 采购 · 花砖采购/)).toBeTruthy()
    fireEvent.click(screen.getByText('建立关联'))
    await waitFor(() => expect(api.createRelation).toHaveBeenCalledWith({
      from_record_id: ledger.id,
      to_record_id: procurement.id,
      relation_type: 'pays_for',
    }))
    fireEvent.click(screen.getByText('移除'))
    await waitFor(() => expect(api.removeRelation).toHaveBeenCalledWith('relation-1'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('可能影响账本待付'))
    expect(screen.queryByText('pays_for')).toBeNull()
    confirm.mockRestore()
  })

  it('批量确认失败时保留勾选和编辑内容', async () => {
    vi.mocked(api.confirmCandidateBundle).mockRejectedValue(new Error('整批未保存'))
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('施工问题：主卧门口地砖有一处破裂')
    const titleInput = screen.getAllByText('标题')[0].closest('label')!.querySelector('input')!
    fireEvent.change(titleInput, { target: { value: '保留这个标题' } })
    fireEvent.click(screen.getByText('确认所选'))

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
    fireEvent.click(await screen.findByText('归档并隐藏'))

    await waitFor(() => expect(api.setRecordArchived).toHaveBeenCalledWith('event-1', true))
  })

  it('按记录类型解释待确认待处理以及编辑归档操作', async () => {
    const decision = {
      id: 'decision-1', record_type: 'decision', title: '确定铺贴方向', status: 'pending',
      description: null, archived_at: null, source_refs: [{ source_id: source.id, evidence_excerpt: null }],
    }
    const todo = {
      id: 'todo-1', record_type: 'todo', title: '现场复核', status: 'pending',
      description: null, archived_at: null, source_refs: [{ source_id: source.id, evidence_excerpt: null }],
    }
    vi.mocked(api.listRecords).mockResolvedValue([decision, todo])

    render(<DomainWorkspace refreshKey={0} />)
    expect(await screen.findByText('这条来源已保存的记录')).toBeTruthy()
    expect(screen.getByText('这个决定还没有最终确定。')).toBeTruthy()
    expect(screen.getByText('这项待办还没有开始处理。')).toBeTruthy()

    const recordList = screen.getByText('这条来源已保存的记录')
      .closest('.record-list') as HTMLElement
    const decisionCard = within(recordList).getByText('决策 · 确定铺贴方向').closest('article')!
    const todoCard = within(recordList).getByText('待办 · 现场复核').closest('article')!
    expect(decisionCard.textContent).toContain('状态：待确认')
    expect(todoCard.textContent).toContain('状态：待处理')
    expect(within(todoCard).getByText(/归档不会删除记录/)).toBeTruthy()

    fireEvent.click(within(todoCard).getByText('修改标题/状态'))
    expect(within(todoCard).getByLabelText('记录标题')).toBeTruthy()
    expect(within(todoCard).getByLabelText('当前状态')).toBeTruthy()
    expect(within(todoCard).getByText('保存修改')).toBeTruthy()
    fireEvent.click(within(todoCard).getByText('取消'))
    expect(within(todoCard).queryByLabelText('记录标题')).toBeNull()
  })
})
