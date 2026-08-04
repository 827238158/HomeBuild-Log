import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './domainApi'
import { defaultPayload, DomainWorkspace, normalizeMeasurementValues, payloadForSave } from './DomainWorkspace'

vi.mock('./domainApi', () => ({
  listSources: vi.fn(),
  listRecords: vi.fn(),
  createRecord: vi.fn(),
  getLatestCandidateBundle: vi.fn(),
  createExtraction: vi.fn(),
  confirmCandidateBundle: vi.fn(),
  deferCandidate: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
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
  updateSource: vi.fn(),
  getSourceDeletionImpact: vi.fn(),
  deleteSource: vi.fn(),
  reviewRecordSource: vi.fn(),
}))

const source = {
  id: 'source-1',
  project_id: 'project-1',
  input_type: 'text',
  original_text: '主卧门口地砖有一处破裂',
  captured_at: '2026-06-28T10:00:00+08:00',
  reported_time_text: null,
  updated_at: '2026-06-28T10:00:00+08:00',
  revision: 1,
}

const anotherSource = {
  ...source,
  id: 'source-2',
  original_text: '客厅地砖已到场，等待核对数量和批次',
  analysis_status: 'pending' as const,
  generated_record_count: 0,
  pending_candidate_count: 1,
  confirmed_candidate_count: 0,
  ignored_candidate_count: 0,
}

const explicitBundle = {
  id: 'bundle-1', source_id: source.id, extraction_run_id: 'run-1', request_id: 'request-1',
  requested_engine: 'auto' as const, engine: 'local-rule-v1', fallback_reason: null,
  status: 'pending' as const, version: 1, created_at: '2026-06-29T10:00:00+08:00',
  source_revision: 1,
  updated_at: '2026-06-29T10:00:00+08:00', relations: [], warnings: [],
  suggestions: [{
    key: 'issue:1', record_type: 'issue', type_label: '施工问题',
    summary: '主卧门口地砖有一处破裂', evidence: source.original_text,
    certainty: 'explicit' as const, certainty_label: '明确', selected_by_default: true,
    payload: {
      record_type: 'issue', title: '地砖破裂', status: 'open', occurred_date: '2026-06-28',
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
    description: null, archived_at: null, source_refs: [{
      source_id: source.id, evidence_excerpt: source.original_text,
      source_revision: 1, needs_review: false,
    }],
  })
  vi.mocked(api.updateSource).mockResolvedValue(source)
  vi.mocked(api.getSourceDeletionImpact).mockResolvedValue({
    source_id: source.id, attachments: 0, candidate_bundles: 1, extraction_runs: 1,
    exclusive_records: 1, shared_records: 0, affected_relations: 0,
  })
  vi.mocked(api.deleteSource).mockResolvedValue({
    source_id: source.id, attachments: 0, candidate_bundles: 1, extraction_runs: 1,
    exclusive_records: 1, shared_records: 0, affected_relations: 0,
    deleted_physical_files: 0, file_cleanup_warnings: [],
  })
  vi.mocked(api.deferCandidate).mockResolvedValue({
    ...explicitBundle,
    status: 'reviewed',
    version: 2,
    suggestions: [{ ...explicitBundle.suggestions[0], review_state: 'deferred', deferred_at: '2026-07-01T10:00:00Z' }],
  })
})

describe('DomainWorkspace', () => {
  it('尺寸默认状态与轴顺序稳定并统一换算为毫米', () => {
    const payload = defaultPayload('measurement', { status: 'planned' })
    expect(payload.status).toBe('active')

    const values = normalizeMeasurementValues([
      { axis: 'height', value: 2, unit: 'm' },
      { axis: 'width', value: 60, unit: 'cm' },
    ])
    expect(values.map((item) => [item.axis, item.value, item.unit])).toEqual([
      ['width', 600, 'mm'],
      ['height', 2000, 'mm'],
      ['length', null, 'mm'],
    ])
    expect(payloadForSave('measurement', { ...payload, values }).values).toEqual([
      { axis: 'width', value: 600, unit: 'mm' },
      { axis: 'height', value: 2000, unit: 'mm' },
    ])
  })

  it('外部保存新来源后优先选中后端返回的来源 ID', async () => {
    vi.mocked(api.listSources).mockResolvedValue([source, anotherSource])
    render(<DomainWorkspace refreshKey={1} preferredSourceId={anotherSource.id} />)

    const picker = (await screen.findByText('原始数据来源')).parentElement!
    expect(within(picker).getByRole('button', { name: /客厅地砖已到场/ })).toBeTruthy()
  })

  it('真实指针选择顺序不显示顶部全文浮层', async () => {
    vi.mocked(api.listSources).mockResolvedValue([source, anotherSource])
    render(<DomainWorkspace refreshKey={0} />)

    const picker = (await screen.findByText('原始数据来源')).parentElement
    expect(picker).toBeTruthy()
    const pickerUi = within(picker as HTMLElement)
    fireEvent.click(pickerUi.getByRole('button', { name: /主卧门口地砖/ }))
    const option = screen.getByRole('option', { name: /客厅地砖已到场/ })
    fireEvent.pointerDown(option)
    fireEvent.focus(option)
    fireEvent.pointerUp(option)
    fireEvent.click(option)

    expect(pickerUi.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('长按显示原始数据全文并在松开后关闭', async () => {
    vi.mocked(api.listSources).mockResolvedValue([source, anotherSource])
    render(<DomainWorkspace refreshKey={0} />)

    const picker = (await screen.findByText('原始数据来源')).parentElement
    const pickerUi = within(picker as HTMLElement)
    fireEvent.click(pickerUi.getByRole('button', { name: /主卧门口地砖/ }))
    const option = screen.getByRole('option', { name: /客厅地砖已到场/ })

    fireEvent.pointerDown(option)
    expect((await screen.findByRole('tooltip')).textContent).toBe(anotherSource.original_text)

    fireEvent.pointerUp(option)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('来源下拉显示明确的待处理数量', async () => {
    vi.mocked(api.listSources).mockResolvedValue([source, anotherSource])
    render(<DomainWorkspace refreshKey={0} />)

    const picker = (await screen.findByText('原始数据来源')).parentElement
    const pickerUi = within(picker as HTMLElement)
    fireEvent.click(pickerUi.getByRole('button', { name: /主卧门口地砖/ }))

    expect(screen.getByRole('option', { name: /待处理 1 条/ })).toBeTruthy()
  })

  it('来源和多选下拉在菜单内部滚动时保持展开', async () => {
    vi.mocked(api.listSources).mockResolvedValue([source, anotherSource])
    render(<DomainWorkspace refreshKey={0} />)

    const picker = (await screen.findByText('原始数据来源')).parentElement!
    fireEvent.click(within(picker).getByRole('button', { name: /主卧门口地砖/ }))
    const sourceMenu = screen.getByRole('listbox')
    fireEvent.scroll(sourceMenu)
    fireEvent.wheel(sourceMenu)
    expect(screen.getByRole('listbox')).toBe(sourceMenu)

    fireEvent.click(screen.getAllByRole('button', { name: '请选择（可多选）' })[0])
    const multiMenu = screen.getByRole('listbox')
    fireEvent.scroll(multiMenu)
    fireEvent.wheel(multiMenu)
    expect(screen.getByRole('listbox')).toBe(multiMenu)
  })

  it('候选全部忽略后显示已分析且没有待处理项', async () => {
    const ignoredBundle = {
      ...explicitBundle,
      status: 'reviewed' as const,
      suggestions: [{
        ...explicitBundle.suggestions[0],
        review_state: 'deferred' as const,
        deferred_at: '2026-07-01T10:00:00Z',
      }],
    }
    vi.mocked(api.listSources).mockResolvedValue([{
      ...source,
      analysis_status: 'reviewed',
      generated_record_count: 0,
      pending_candidate_count: 0,
      confirmed_candidate_count: 0,
      ignored_candidate_count: 1,
    }])
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue(ignoredBundle)

    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('待处理 0 条 · 已生成 0 条 · 已忽略 1 条')).toBeTruthy()
    expect(screen.getByText('候选均已忽略，可按需重新分析。')).toBeTruthy()
    expect(screen.queryByText('暂未识别，原始文字已经保留。')).toBeNull()
    expect(screen.queryByLabelText('标题')).toBeNull()
  })

  it('历史待办候选统一转换为问题', async () => {
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle,
      suggestions: [{
        ...explicitBundle.suggestions[0],
        key: 'todo:1', record_type: 'todo', type_label: '待办',
        payload: {
          record_type: 'todo', title: '完成验收', status: 'done', action: '完成验收',
          completed_at: '2026-06-30', completion_evidence: '已经验收', source_refs: [{ source_id: source.id }],
        },
      }],
    })
    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('问题：主卧门口地砖有一处破裂')).toBeTruthy()
    expect(screen.getByLabelText('实际完成日期')).toHaveProperty('value', '2026-06-30')
    fireEvent.change(screen.getByLabelText('严重程度'), { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: '确认所选' }))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(vi.mocked(api.confirmCandidateBundle).mock.calls.at(-1)?.[2][0].payload)
      .toMatchObject({ record_type: 'issue', completed_at: '2026-06-30', actual_result: '已经验收' })
  })

  it('没有已有候选时不会静默触发重新分析', async () => {
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue(null)
    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('暂未识别，原始文字已经保留。')).toBeTruthy()
    expect(api.createExtraction).not.toHaveBeenCalled()
  })

  it('修改原始数据后提示重新分析和复核', async () => {
    const updated = { ...source, original_text: '修正后的原始数据', revision: 2 }
    vi.mocked(api.listSources)
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([updated])
    vi.mocked(api.updateSource).mockResolvedValue(updated)
    render(<DomainWorkspace refreshKey={0} />)

    fireEvent.click(await screen.findByText('修改原始数据'))
    fireEvent.change(screen.getByLabelText('原始文字'), {
      target: { value: '修正后的原始数据' },
    })
    fireEvent.click(screen.getByText('保存修改'))

    await waitFor(() => expect(api.updateSource).toHaveBeenCalledWith(source.id, {
      original_text: '修正后的原始数据', reported_time_text: null,
    }))
    expect(await screen.findByText(/旧候选已失效/)).toBeTruthy()
    expect(screen.getByText(/来源版本 2/)).toBeTruthy()
  })

  it('删除前展示影响统计并在确认后级联删除', async () => {
    vi.mocked(api.listSources)
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DomainWorkspace refreshKey={0} />)

    fireEvent.click(await screen.findByText('删除原始数据'))

    await waitFor(() => expect(api.deleteSource).toHaveBeenCalledWith(source.id))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 条独占正式记录'))
    expect(await screen.findByText('原始数据及关联记录已删除。')).toBeTruthy()
    confirm.mockRestore()
  })

  it('默认勾选明确建议并批量确认', async () => {
    render(<DomainWorkspace refreshKey={0} />)

    expect(screen.getByRole('heading', { name: '智能拆分' })).toBeTruthy()
    expect(await screen.findByText('问题：主卧门口地砖有一处破裂')).toBeTruthy()
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    const confirmButton = screen.getByRole('button', { name: '确认所选' }) as HTMLButtonElement
    expect(checkbox.checked).toBe(true)
    expect(confirmButton.disabled).toBe(false)
    fireEvent.click(checkbox)
    expect(confirmButton.disabled).toBe(true)
    fireEvent.click(checkbox)
    expect(confirmButton.disabled).toBe(false)
    fireEvent.change(screen.getAllByText('标题')[0].closest('label')!.querySelector('input')!, {
      target: { value: '主卧地砖破裂' },
    })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(vi.mocked(api.confirmCandidateBundle).mock.calls[0][2][0]).toMatchObject({
      key: 'issue:1', payload: { title: '主卧地砖破裂' },
    })
  })

  it('全部候选已确认时禁用按钮，添加未确认手工记录后恢复', async () => {
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle,
      status: 'confirmed',
      suggestions: [{
        ...explicitBundle.suggestions[0],
        review_state: 'confirmed',
        confirmed_record_id: 'record-1',
      }],
    })
    render(<DomainWorkspace refreshKey={0} />)

    await screen.findByText('问题：主卧门口地砖有一处破裂')
    const confirmButton = screen.getByRole('button', { name: '确认所选' }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(true)

    fireEvent.click(screen.getByText('+ 添加手工记录'))
    expect(confirmButton.disabled).toBe(false)

    const manualPanel = screen.getAllByLabelText('标题').at(-1)!.closest('article')!
    fireEvent.click(within(manualPanel).getByText('移除'))
    expect(confirmButton.disabled).toBe(true)
  })

  it('不确定建议默认也会勾选', async () => {
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle, suggestions: [{
        key: 'research:1', record_type: 'research', type_label: '调研',
        summary: '是否更换地砖', evidence: '是否更换地砖', certainty: 'uncertain',
        certainty_label: '不确定', selected_by_default: false, payload: { title: '调研', occurred_date: null }, missing_fields: ['结论'],
        review_state: 'active', deferred_at: null, confirmed_record_id: null,
      }],
    })
    render(<DomainWorkspace refreshKey={0} />)

    expect(await screen.findByText('调研：是否更换地砖')).toBeTruthy()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('记录类型中不再提供待办并可切换其他类型', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')

    const typeSelect = screen.getAllByLabelText('记录类型')[0].closest('label')!.querySelector('select')!
    expect(Array.from(typeSelect.options).some((option) => option.value === 'todo')).toBe(false)
    fireEvent.change(typeSelect, { target: { value: 'research' } })
    expect(screen.getByLabelText('调研问题')).toBeTruthy()
    expect(screen.queryByLabelText('问题现象')).toBeNull()
  })

  it('调研候选切换为问题后提交人工选择的类型', async () => {
    const researchSuggestion = {
      ...explicitBundle.suggestions[0],
      key: 'research:1',
      record_type: 'research',
      type_label: '调研',
      summary: '壁龛如何铺贴',
      payload: {
        record_type: 'research', title: '壁龛铺贴调研', status: 'collecting',
        question: '壁龛如何铺贴', options: ['花砖', '普通砖'],
      },
    }
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle,
      suggestions: [researchSuggestion],
    })
    render(<DomainWorkspace refreshKey={0} />)

    const card = (await screen.findByText('调研：壁龛如何铺贴')).closest('article')!
    fireEvent.change(within(card).getByLabelText('记录类型'), { target: { value: 'issue' } })
    fireEvent.change(within(card).getByLabelText('问题现象'), {
      target: { value: '壁龛铺贴方案尚未确认' },
    })
    fireEvent.change(within(card).getByLabelText('严重程度'), { target: { value: 'medium' } })
    fireEvent.click(screen.getByRole('button', { name: '确认所选' }))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(vi.mocked(api.confirmCandidateBundle).mock.calls.at(-1)?.[2][0].payload)
      .toMatchObject({
        record_type: 'issue',
        status: 'pending',
        phenomenon: '壁龛铺贴方案尚未确认',
        severity: 'medium',
      })
  })

  it('问题业务时间只提交年月日', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')

    fireEvent.change(screen.getByLabelText('严重程度'), { target: { value: 'medium' } })
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'done' } })
    fireEvent.change(screen.getByLabelText('实际完成日期'), { target: { value: '2026-07-07' } })
    fireEvent.change(screen.getByLabelText('实际处理结果'), { target: { value: '已完成复核' } })
    fireEvent.click(screen.getByRole('button', { name: '确认所选' }))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(vi.mocked(api.confirmCandidateBundle).mock.calls.at(-1)?.[2][0].payload).toMatchObject({
      completed_at: '2026-07-07', actual_result: '已完成复核', severity: 'medium',
    })
  })

  it('添加手工记录后显示示例且确认时调用 createRecord', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')

    fireEvent.click(screen.getByText('+ 添加手工记录'))
    const panels = screen.getAllByLabelText('标题')
    const manualPanel = panels.at(-1)!.closest('article')!
    const form = within(manualPanel)
    const typeSelect = form.getByLabelText('记录类型')

    expect(form.getByLabelText('标题')).toHaveProperty('placeholder', '例如：主卧地砖铺贴完成')
    expect(form.getByLabelText('事件类型')).toHaveProperty('placeholder', '例如：现场查看、施工完成或验收')
    expect(form.getByLabelText('补充内容')).toHaveProperty('placeholder', '例如：已完成铺贴并现场验收')

    fireEvent.change(typeSelect, { target: { value: 'ledger' } })
    expect(form.getByLabelText('标题')).toHaveProperty('placeholder', '例如：支付花砖预付款')
    expect(form.getByLabelText('金额（元）')).toHaveProperty('type', 'number')
    expect(form.getByLabelText('金额（元）')).toHaveProperty('value', '')
    expect(Array.from((form.getByLabelText('状态') as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      '计划中', '已出账', '已作废',
    ])
    fireEvent.change(form.getByLabelText('账目类型'), { target: { value: 'refund' } })
    expect(form.getByLabelText('状态')).toHaveProperty('value', 'posted')
    expect(Array.from((form.getByLabelText('状态') as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      '计划中', '已入账', '已作废',
    ])

    fireEvent.change(typeSelect, { target: { value: 'measurement' } })
    expect(form.getByLabelText('宽度')).toHaveProperty('type', 'number')
    expect(form.getByLabelText('高度')).toHaveProperty('type', 'number')
    expect(form.getByLabelText('长度')).toHaveProperty('type', 'number')

    fireEvent.change(typeSelect, { target: { value: 'decision' } })
    fireEvent.change(form.getByLabelText('标题'), { target: { value: '铺贴方案' } })
    fireEvent.change(form.getByLabelText('决策主题'), { target: { value: '花砖方向' } })
    fireEvent.change(form.getByLabelText('选项（逗号分隔）'), { target: { value: '横贴（省料），竖贴：更整齐' } })
    fireEvent.click(screen.getByText('确认所选'))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(vi.mocked(api.createRecord).mock.calls.at(-1)?.[0]).toMatchObject({
      options: ['横贴（省料）', '竖贴：更整齐'],
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
    await screen.findByText('问题：主卧门口地砖有一处破裂')
    fireEvent.click(within(screen.getByLabelText('已有材料')).getByText('删除'))

    expect(await screen.findByText('该材料已被正式记录使用，请先解除记录关联。')).toBeTruthy()
    confirm.mockRestore()
  })

  it('在候选可选栏中关联已有正式记录', async () => {
    const ledger = { id: 'ledger-1', record_type: 'ledger', ledger_kind: 'payment', title: '500 元预付款', status: 'paid', description: null, archived_at: null, source_refs: [] }
    const refund = { id: 'refund-1', record_type: 'ledger', ledger_kind: 'refund', title: '花砖退款', status: 'posted', description: null, archived_at: null, source_refs: [] }
    vi.mocked(api.listRecords).mockResolvedValue([ledger, refund])

    render(<DomainWorkspace refreshKey={0} />)
    const relationField = await screen.findByRole('group', { name: '关联记录（可选）' })
    fireEvent.click(within(relationField).getByRole('button'))
    fireEvent.click(await screen.findByLabelText('账目 · 500 元预付款'))
    fireEvent.click(screen.getByRole('button', { name: '确认所选' }))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    const selections = vi.mocked(api.confirmCandidateBundle).mock.calls.at(-1)?.[2]
    expect(selections?.[0].payload.related_record_ids).toEqual([ledger.id])
    expect(screen.queryByText('记录之间的关联（一般无需手动设置）')).toBeNull()
  })

  it('显式展示并允许移除本批候选的通用关联', async () => {
    const second = {
      ...explicitBundle.suggestions[0],
      key: 'issue:2',
      summary: '第二个问题',
      payload: { ...explicitBundle.suggestions[0].payload, title: '第二个问题' },
    }
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle,
      suggestions: [explicitBundle.suggestions[0], second],
      relations: [{ from_key: 'issue:1', to_key: 'issue:2', relation_type: 'relates_to' }],
    })

    render(<DomainWorkspace refreshKey={0} />)
    const firstCard = (await screen.findByDisplayValue('地砖破裂')).closest('article')!
    const relationField = within(firstCard).getByRole('group', { name: '关联本批候选（可选）' })
    fireEvent.click(within(relationField).getByRole('button'))
    const relatedOption = await screen.findByLabelText('问题 · 第二个问题')
    expect(relatedOption).toHaveProperty('checked', true)
    fireEvent.click(relatedOption)
    fireEvent.click(screen.getByRole('button', { name: '确认所选' }))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(vi.mocked(api.confirmCandidateBundle).mock.calls.at(-1)?.[4]).toEqual([])
  })

  it('批量确认失败时保留勾选和编辑内容', async () => {
    vi.mocked(api.confirmCandidateBundle).mockRejectedValue(new Error('整批未保存'))
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')
    const titleInput = screen.getAllByText('标题')[0].closest('label')!.querySelector('input')!
    fireEvent.change(titleInput, { target: { value: '保留这个标题' } })
    fireEvent.click(screen.getByText('确认所选'))

    expect(await screen.findByText('整批未保存')).toBeTruthy()
    expect((titleInput as HTMLInputElement).value).toBe('保留这个标题')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('添加的手工记录可单独移除且不影响提交', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')

    fireEvent.click(screen.getByText('+ 添加手工记录'))
    expect(screen.getAllByLabelText('标题').length).toBe(2)

    const panels = screen.getAllByLabelText('标题')
    const manualPanel = panels.at(-1)!.closest('article')!
    fireEvent.click(within(manualPanel).getByText('移除'))

    await waitFor(() => expect(screen.getAllByLabelText('标题').length).toBe(1))
    fireEvent.click(screen.getByText('确认所选'))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalled())
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('AI 候选移除后持久化，确认其他记录时不会重新出现', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')

    fireEvent.click(screen.getByText('+ 添加手工记录'))
    expect(screen.getAllByLabelText('标题').length).toBe(2)

    const panels = screen.getAllByLabelText('标题')
    const aiPanel = panels[0]!.closest('article')!
    fireEvent.click(within(aiPanel).getByText('移除'))

    await waitFor(() => expect(screen.queryByText('问题：主卧门口地砖有一处破裂')).toBeNull())
    expect(api.deferCandidate).toHaveBeenCalledWith('bundle-1', 'issue:1', 1)
    expect(screen.getAllByLabelText('标题').length).toBe(1)
    fireEvent.click(screen.getByText('确认所选'))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(api.confirmCandidateBundle).not.toHaveBeenCalled()
  })

  it('删除其他 AI 候选时保留已编辑内容和勾选状态', async () => {
    const second = {
      ...explicitBundle.suggestions[0], key: 'issue:2', summary: '删除候选',
      payload: { ...explicitBundle.suggestions[0].payload, title: '删除我' },
    }
    const twoCandidates = { ...explicitBundle, suggestions: [explicitBundle.suggestions[0], second] }
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue(twoCandidates)
    vi.mocked(api.deferCandidate).mockResolvedValue({
      ...twoCandidates, version: 2,
      suggestions: [explicitBundle.suggestions[0], { ...second, review_state: 'deferred', deferred_at: '2026-07-03T00:00:00Z' }],
    })
    render(<DomainWorkspace refreshKey={0} />)

    const firstTitle = await screen.findByDisplayValue('地砖破裂')
    fireEvent.change(firstTitle, { target: { value: '保留用户编辑' } })
    const secondPanel = screen.getByDisplayValue('删除我').closest('article')!
    fireEvent.click(within(secondPanel).getByText('移除'))

    await waitFor(() => expect(screen.queryByDisplayValue('删除我')).toBeNull())
    expect(screen.getByDisplayValue('保留用户编辑')).toBeTruthy()
    expect((screen.getByDisplayValue('保留用户编辑').closest('article')!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
  })

  it('确认所选时原子忽略未勾选候选且不恢复', async () => {
    const second = {
      ...explicitBundle.suggestions[0], key: 'issue:2', summary: '不需要的候选',
      payload: { ...explicitBundle.suggestions[0].payload, title: '不需要' },
    }
    const twoCandidates = { ...explicitBundle, suggestions: [explicitBundle.suggestions[0], second] }
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue(twoCandidates)
    vi.mocked(api.confirmCandidateBundle).mockResolvedValue({
      records: [],
      bundle: {
        ...twoCandidates, version: 2, status: 'confirmed', suggestions: [
          { ...explicitBundle.suggestions[0], review_state: 'confirmed', confirmed_record_id: 'record-1' },
          { ...second, review_state: 'deferred', deferred_at: '2026-07-03T00:00:00Z' },
        ],
      },
    })
    render(<DomainWorkspace refreshKey={0} />)

    const secondPanel = (await screen.findByDisplayValue('不需要')).closest('article')!
    fireEvent.click(within(secondPanel).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '确认所选' }))

    await waitFor(() => expect(api.confirmCandidateBundle).toHaveBeenCalledWith(
      'bundle-1', 1, expect.any(Array), ['issue:2'], [],
    ))
    expect(screen.queryByDisplayValue('不需要')).toBeNull()
  })

  it('从原始来源创建可追溯的问题记录', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    expect(await screen.findByText(source.original_text)).toBeTruthy()

    fireEvent.click(screen.getByText('+ 添加手工记录'))
    const panels = screen.getAllByLabelText('标题')
    const manualPanel = panels.at(-1)!.closest('article')!
    const form = within(manualPanel)
    fireEvent.change(form.getByLabelText('记录类型').closest('label')!.querySelector('select')!, {
      target: { value: 'issue' },
    })
    fireEvent.change(form.getByLabelText('标题'), { target: { value: '现场复核' } })
    fireEvent.change(form.getByLabelText('问题现象'), { target: { value: '等待门套施工后复核' } })
    fireEvent.change(form.getByLabelText('严重程度'), { target: { value: 'low' } })
    fireEvent.click(screen.getByText('确认所选'))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(vi.mocked(api.createRecord).mock.calls[0][0]).toMatchObject({
      record_type: 'issue',
      title: '现场复核',
      source_refs: [{ source_id: source.id, evidence_excerpt: source.original_text }],
      phenomenon: '等待门套施工后复核',
      severity: 'low',
    })
  })

  it('录入界面不再展示已保存记录组件', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')
    expect(screen.queryByText('已保存的记录')).toBeNull()
  })

  it('尺寸候选显示中文用途并把非法值规范化为现场测量', async () => {
    vi.mocked(api.getLatestCandidateBundle).mockResolvedValue({
      ...explicitBundle,
      suggestions: [{
        ...explicitBundle.suggestions[0],
        key: 'measurement:1', record_type: 'measurement', type_label: '尺寸',
        payload: {
          record_type: 'measurement', title: '门洞尺寸', status: 'active',
          object_name: '门洞', measurement_role: 'invalid-role', values: [],
        },
      }],
    })

    render(<DomainWorkspace refreshKey={0} />)

    const role = await screen.findByLabelText('尺寸用途') as HTMLSelectElement
    expect(role.value).toBe('site_measurement')
  })

  it('手工记录未填写标题时确认提交兜底标题', async () => {
    render(<DomainWorkspace refreshKey={0} />)
    await screen.findByText('问题：主卧门口地砖有一处破裂')

    fireEvent.click(screen.getByText('+ 添加手工记录'))
    fireEvent.click(screen.getByText('确认所选'))

    await waitFor(() => expect(api.createRecord).toHaveBeenCalled())
    expect(vi.mocked(api.createRecord).mock.calls[0][0]).toMatchObject({
      record_type: 'event',
      title: '用户手工录入',
    })
  })

})
