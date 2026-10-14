vi.mock('./TopicSelect', () => ({ TopicSelect: ({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) => <div><output data-testid="topics">{value.join(',')}</output><button type="button" onClick={() => onChange([])}>清空主题归属</button></div> }))
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './domainApi'
import { BusinessEntryForm } from './BusinessEntryForm'
import { confirmNavigation } from './navigationGuard'

vi.mock('./domainApi', () => ({ createDirectRecord: vi.fn(), listEntities: vi.fn(), listSpaces: vi.fn(), listRecords: vi.fn(), createEntity: vi.fn() }))
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function select(label: string, value: string) {
  fireEvent.click(screen.getByRole('combobox', { name: new RegExp(`^${label}：`) }))
  fireEvent.click(screen.getByRole('option', { name: value }))
}
async function ledger() {
  const saved = vi.fn()
  render(<BusinessEntryForm kind="ledger" onSaved={saved} />)
  fireEvent.click(screen.getByRole('button', { name: '记一笔账' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: /^交易对象/ }).getAttribute('aria-disabled')).toBe('false'))
  fill('账目名称', '灯带尾款'); fill('金额（元）', '19.99'); fill('款项性质', '尾款')
  select('交易对象（收付款方）', '灯具店')
  return saved
}
describe('业务页直接创建', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listSpaces).mockResolvedValue([])
    vi.mocked(api.listRecords).mockResolvedValue([])
    vi.mocked(api.listEntities).mockResolvedValue([{ id: 'vendor', name: '灯具店' } as api.NamedEntity])
    vi.mocked(api.createDirectRecord).mockResolvedValue({ id: 'new' } as api.DomainRecord)
  })
  it.each([['付款', 'payment', 'expense', 'paid'], ['退款', 'refund', 'refund', 'posted'], ['收入', 'income', 'income', 'posted']])('直接保存%s及准确金额', async (label, kind, direction, status) => {
    const saved = await ledger(); select('账目类型', label)
    fireEvent.click(screen.getByRole('button', { name: '保存账目' }))
    await screen.findByText('账目已保存')
    expect(api.createDirectRecord).toHaveBeenCalledWith(expect.objectContaining({ record_type: 'ledger', ledger_kind: kind, direction, status, amount_minor: 1999, currency: 'CNY', vendor_id: 'vendor', payment_kind: '尾款' }))
    expect(saved).toHaveBeenCalledOnce()
  })
  it('失败保留草稿，收起仍提醒离开，重试成功清理', async () => {
    vi.mocked(api.createDirectRecord).mockRejectedValueOnce(new Error('网络中断'))
    const saved = await ledger()
    fireEvent.click(screen.getByRole('button', { name: '保存账目' }))
    await screen.findByText('网络中断'); expect((screen.getByLabelText('账目名称') as HTMLInputElement).value).toBe('灯带尾款')
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(confirmNavigation()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '记一笔账' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '保存账目' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '保存账目' }))
    await screen.findByText('账目已保存'); expect(saved).toHaveBeenCalledOnce()
    expect(confirmNavigation()).toBe(true); confirmation.mockRestore()
  })
  it('拒绝三位小数，避免静默改变金额', async () => {
    await ledger(); fill('金额（元）', '1.001')
    fireEvent.click(screen.getByRole('button', { name: '保存账目' }))
    expect((await screen.findByRole('alert')).textContent).toContain('最多两位小数')
    expect(api.createDirectRecord).not.toHaveBeenCalled()
  })
  it('保存待办使用现有字段', async () => {
    const saved = vi.fn()
    render(<BusinessEntryForm kind="issue" onSaved={saved} />)
    fireEvent.click(screen.getByRole('button', { name: '新增待办或问题' }))
    fill('事项标题', '核对尺寸'); fill('事项内容', '与师傅核对柜内净宽'); fill('处理计划（可选）', '明天现场测量')
    fireEvent.click(screen.getByRole('button', { name: '保存事项' }))
    await screen.findByText('待办与问题已保存')
    expect(api.createDirectRecord).toHaveBeenCalledWith(expect.objectContaining({ record_type: 'issue', status: 'pending', phenomenon: '与师傅核对柜内净宽', severity: 'medium', handling_plan: '明天现场测量' }))
  })
  it('显式新增交易对象后选中，失败不清空名称', async () => {
    await ledger()
    vi.mocked(api.createEntity).mockRejectedValueOnce(new Error('名称保存失败')).mockResolvedValueOnce({ id: 'new-vendor', name: '新店' } as api.NamedEntity)
    fill('新增交易对象（可选）', '新店')
    fireEvent.click(screen.getByRole('button', { name: '添加并选中' }))
    await screen.findByText('名称保存失败'); expect((screen.getByLabelText('新增交易对象（可选）') as HTMLInputElement).value).toBe('新店')
    fireEvent.click(screen.getByRole('button', { name: '添加并选中' }))
    await screen.findByRole('combobox', { name: '交易对象（收付款方）：新店' })
    fireEvent.click(screen.getByRole('button', { name: '保存账目' }))
    await screen.findByText('账目已保存')
    expect(api.createDirectRecord).toHaveBeenCalledWith(expect.objectContaining({ vendor_id: 'new-vendor' }))
  })
})

it('从主题创建待办预选归属，失败重试保留选择', async () => {
  vi.mocked(api.listEntities).mockResolvedValue([])
  vi.mocked(api.createDirectRecord).mockRejectedValueOnce(new Error('保存中断')).mockResolvedValueOnce({id:'new'} as api.DomainRecord)
  render(<BusinessEntryForm kind="issue" initialTopicId="theme" onSaved={vi.fn()} />)
  expect(screen.getByTestId('topics').textContent).toBe('theme')
  fill('事项标题','核对开关'); fill('事项内容','确认零线')
  fireEvent.click(screen.getByRole('button',{name:'保存事项'}))
  await screen.findByText('保存中断')
  expect(screen.getByTestId('topics').textContent).toBe('theme')
  fireEvent.click(screen.getByRole('button',{name:'保存事项'}))
  await screen.findByText('待办与问题已保存')
  expect(api.createDirectRecord).toHaveBeenLastCalledWith(expect.objectContaining({topic_ids:['theme']}))
})


it('待办补充字段支持多个处理人，收起与保存失败保留', async () => {
  vi.mocked(api.listSpaces).mockResolvedValue([{ id: 'kitchen', name: '厨房', kind: 'room', parent_id: null } as api.SpaceEntry])
  vi.mocked(api.listRecords).mockResolvedValue([])
  vi.mocked(api.listEntities).mockImplementation(async kind => kind === 'participants' ? [{ id: 'p1', name: '师傅甲' }, { id: 'p2', name: '师傅乙' }] as api.NamedEntity[] : [])
  vi.mocked(api.createDirectRecord).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce({ id: 'new' } as api.DomainRecord)
  render(<BusinessEntryForm kind="issue" onSaved={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '新增待办或问题' }))
  fill('事项标题', '测量柜体'); fill('事项内容', '共同复核净宽')
  fireEvent.click(screen.getByRole('button', { name: /更多信息与关联/ }))
  const trigger = await screen.findByRole('button', { name: /^处理人：/ })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('checkbox', { name: '师傅甲' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '师傅乙' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: /更多信息与关联/ }))
  fireEvent.click(screen.getByRole('button', { name: '保存事项' }))
  await screen.findByText('保存失败')
  fireEvent.click(screen.getByRole('button', { name: '保存事项' }))
  await screen.findByText('待办与问题已保存')
  expect(api.createDirectRecord).toHaveBeenLastCalledWith(expect.objectContaining({ participant_ids: ['p1', 'p2'] }))
})
