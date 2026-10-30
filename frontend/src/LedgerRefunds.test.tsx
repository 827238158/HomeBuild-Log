import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LedgerRefunds } from './LedgerRefunds'
import * as api from './domainApi'
import type { ProjectionRecord } from './domainApi'
import { HttpError } from './http'
import { beijingToday } from './time'
import { startVoiceRecording } from './voiceAudio'
import { transcribeAudio } from './api'

vi.mock('./domainApi', () => ({ listLedgerRefunds: vi.fn(), registerLedgerRefund: vi.fn(), listSpaces: vi.fn(), listEntities: vi.fn() }))
vi.mock('./voiceAudio', () => ({ MAX_RECORDING_MS: 180_000, startVoiceRecording: vi.fn() }))
vi.mock('./api', () => ({ transcribeAudio: vi.fn() }))

const base: ProjectionRecord = {
  id: 'payment', version: 3, record_type: 'ledger', ledger_kind: 'payment', direction: 'expense',
  title: '灯具付款', status: 'paid', amount_minor: 10000, description: '原付款备注',
  occurred_date: '2026-09-01', original_time_text: null, created_at: '2026-09-01T00:00:00Z',
  archived_at: null, space_ids: ['room'], spaces: [], material_ids: [], materials: [],
  participant_ids: [], participants: [], attachment_ids: [], source_refs: [], stage_id: 'stage',
  refunded_minor: 2000, refundable_minor: 8000, refund_state: 'partial',
}
const refund: ProjectionRecord = {
  ...base, id: 'refund', version: 1, ledger_kind: 'refund', direction: 'refund', status: 'posted',
  amount_minor: 2000, occurred_date: '2026-10-02', description: '少发配件退款', refund_of_record_id: base.id,
}
let payment: ProjectionRecord
let rows: ProjectionRecord[]
function fixture(record = base) {
  const onPaymentChanged = vi.fn(), onOpen = vi.fn(), onBusyChange = vi.fn(), onCountChange = vi.fn()
  const rendered = render(<LedgerRefunds record={record} onPaymentChanged={onPaymentChanged} onOpen={onOpen} onBusyChange={onBusyChange} onCountChange={onCountChange} />)
  return { ...rendered, onPaymentChanged, onOpen, onBusyChange, onCountChange }
}
async function begin() { fireEvent.click(await screen.findByRole('button', { name: '登记退款' })) }
const submit = () => fireEvent.submit(screen.getByRole('form', { name: '登记退款' }))
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear()
  payment = { ...base }; rows = [{ ...refund }]
  vi.mocked(api.listLedgerRefunds).mockImplementation(async () => ({ payment, items: rows, excluded_topic_names: [] }))
  vi.mocked(api.listSpaces).mockResolvedValue([{ id: 'room', name: '客厅', kind: 'room', parent_id: null }])
  vi.mocked(api.listEntities).mockResolvedValue([{ id: 'stage', name: '安装阶段' }])
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
  vi.stubGlobal('AudioContext', vi.fn())
  vi.mocked(startVoiceRecording).mockResolvedValue({ finish: vi.fn(() => new File(['wav'], 'recording.wav', { type: 'audio/wav' })), cancel: vi.fn() })
})
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('从原付款登记部分退款，默认余额与北京时间日期，成功刷新并停留在原付款', async () => {
  vi.mocked(api.registerLedgerRefund).mockImplementation(async () => {
    payment = { ...base, version: 4, refunded_minor: 5000, refundable_minor: 5000 }
    const created = { ...refund, id: 'refund-new', amount_minor: 3000, description: '退掉一盏灯' }
    rows = [...rows, created]
    return { payment, refund: created }
  })
  const view = fixture()
  await begin()
  expect((screen.getByLabelText('退款金额（元）') as HTMLInputElement).value).toBe('80.00')
  expect((screen.getByLabelText('退款日期') as HTMLInputElement).value).toBe(beijingToday())
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '30.00' } })
  fireEvent.change(screen.getByLabelText('退款备注（可选）'), { target: { value: '退掉一盏灯' } })
  submit()
  await screen.findByText('退款已登记')
  expect(api.registerLedgerRefund).toHaveBeenCalledWith('payment', expect.objectContaining({ amount_minor: 3000, refund_date: beijingToday(), description: '退掉一盏灯', expected_version: 3, request_id: expect.stringMatching(/^[\da-f-]{36}$/) }))
  expect(view.onPaymentChanged).toHaveBeenCalledWith(payment)
  expect(view.onOpen).not.toHaveBeenCalled()
  expect(screen.queryByRole('form')).toBeNull()
  expect(sessionStorage.getItem('ledger:payment:refund')).toBeNull()
  expect((await screen.findByRole('list', { name: '退款历史' })).textContent).toContain('退掉一盏灯')
})

it.each(['0', '-1', '1.001', 'NaN', '80.01'])('非法或超额退款%s不发送请求并保留草稿', async amount => {
  fixture(); await begin()
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: amount } })
  submit()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(api.registerLedgerRefund).not.toHaveBeenCalled()
  expect((screen.getByLabelText('退款金额（元）') as HTMLInputElement).value).toBe(amount)
})

it('网络失败后原样重试，草稿收起和重新进入仍复用同一请求标识', async () => {
  vi.mocked(api.registerLedgerRefund).mockRejectedValue(new Error('网络中断'))
  const view = fixture(); await begin(); submit()
  await screen.findByText('网络中断')
  const first = vi.mocked(api.registerLedgerRefund).mock.calls[0][1]
  fireEvent.click(screen.getByRole('button', { name: '收起退款表单' }))
  expect(screen.queryByRole('form')).toBeNull()
  view.unmount(); fixture()
  fireEvent.click(await screen.findByRole('button', { name: '确认上次退款' }))
  submit(); await waitFor(() => expect(api.registerLedgerRefund).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[1][1]).toEqual(first)
  await screen.findByText('网络中断')
  expect((screen.getByLabelText('退款金额（元）') as HTMLInputElement).readOnly).toBe(true)
  expect((screen.getByRole('button', { name: '放弃退款草稿' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '70' } })
  submit(); await waitFor(() => expect(api.registerLedgerRefund).toHaveBeenCalledTimes(3))
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[2][1]).toEqual(first)
})

it('请求实际成功但响应丢失，重新进入余额为零仍可幂等确认且历史不重复', async () => {
  vi.mocked(api.registerLedgerRefund).mockRejectedValueOnce(new Error('响应丢失'))
  const view = fixture(); await begin(); submit()
  await screen.findByText('响应丢失')
  const first = vi.mocked(api.registerLedgerRefund).mock.calls[0][1]
  view.unmount()
  payment = { ...base, version: 4, refunded_minor: 10000, refundable_minor: 0, refund_state: 'full' }
  const created = { ...refund, id: 'refund-new', amount_minor: 8000 }
  rows.push(created)
  vi.mocked(api.registerLedgerRefund).mockResolvedValueOnce({ payment, refund: created })
  fixture(payment)
  fireEvent.click(await screen.findByRole('button', { name: '确认上次退款' }))
  expect((screen.getByRole('button', { name: '确认上次保存结果' }) as HTMLButtonElement).disabled).toBe(false)
  submit(); await screen.findByText('退款已登记')
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[1][1]).toEqual(first)
  expect(within(screen.getByRole('list', { name: '退款历史' })).getAllByRole('listitem')).toHaveLength(2)
})

it('冲突保留草稿并要求显式核对，再次保存使用最新版本和额度', async () => {
  const newer = { ...base, version: 4, refunded_minor: 4000, refundable_minor: 6000 }
  vi.mocked(api.registerLedgerRefund).mockRejectedValueOnce(new HttpError('记录已更新', 409, 'record_version_conflict', { latest_record: newer }))
  fixture(); await begin()
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '50' } })
  submit(); await screen.findByRole('region', { name: '核对退款冲突' })
  expect((screen.getByLabelText('退款金额（元）') as HTMLInputElement).value).toBe('50')
  expect((screen.getByRole('button', { name: '确认上次保存结果' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '已核对，继续确认' }))
  vi.mocked(api.registerLedgerRefund).mockResolvedValueOnce({ payment: { ...newer, version: 5 }, refund })
  submit(); await waitFor(() => expect(api.registerLedgerRefund).toHaveBeenLastCalledWith('payment', expect.objectContaining({ amount_minor: 5000, expected_version: 4 })))
})

it('历史付款缺少归属时只给新退款补齐，并提示已归档主题', async () => {
  payment = { ...base, space_ids: [], stage_id: null }
  vi.mocked(api.listLedgerRefunds).mockImplementation(async () => ({ payment, items: rows, excluded_topic_names: ['已归档的灯具调研'] }))
  vi.mocked(api.registerLedgerRefund).mockResolvedValue({ payment, refund })
  fixture(payment); await begin()
  expect(screen.getByText(/已归档的灯具调研/)).toBeTruthy()
  submit(); expect((await screen.findByRole('alert')).textContent).toContain('请选择至少一个空间')
  fireEvent.click(await screen.findByRole('button', { name: /^空间：/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: '客厅' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  submit(); expect((await screen.findByRole('alert')).textContent).toContain('请选择装修阶段')
  fireEvent.click(screen.getByRole('combobox', { name: /^装修阶段：/ }))
  fireEvent.click(screen.getByRole('option', { name: '安装阶段' }))
  submit()
  await waitFor(() => expect(api.registerLedgerRefund).toHaveBeenCalledWith('payment', expect.objectContaining({ space_ids: ['room'], stage_id: 'stage' })))
  expect(payment.space_ids).toEqual([]); expect(payment.stage_id).toBeNull()
})

it('退款历史包含作废提示，跳转只交由导航层统一确认', async () => {
  rows = [{ ...refund, status: 'voided' }]
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const view = fixture(); await begin()
  const row = within(screen.getByRole('list', { name: '退款历史' })).getByRole('button')
  expect(row.textContent).toContain('已作废')
  fireEvent.click(row)
  expect(confirm).not.toHaveBeenCalled()
  expect(view.onOpen).toHaveBeenCalledOnce()
  expect(view.onOpen).toHaveBeenCalledWith(refund.id)
})

it('响应丢失后修正备注不会变成第二笔退款，先用原请求确认已保存的记录', async () => {
  const created = { ...refund, id: 'refund-confirmed', amount_minor: 3000, description: '原备注' }
  let transactions = 0
  vi.mocked(api.registerLedgerRefund).mockImplementationOnce(async () => {
    transactions += 1
    payment = { ...base, version: 4, refunded_minor: 5000, refundable_minor: 5000 }
    rows = [...rows, created]
    throw new TypeError('响应丢失')
  }).mockImplementationOnce(async () => ({ payment, refund: created }))
  const view = fixture(); await begin()
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '30.00' } })
  fireEvent.change(screen.getByLabelText('退款备注（可选）'), { target: { value: '原备注' } })
  submit(); await screen.findByText('响应丢失')
  const original = vi.mocked(api.registerLedgerRefund).mock.calls[0][1]
  expect((screen.getByLabelText('退款备注（可选）') as HTMLTextAreaElement).readOnly).toBe(true)
  expect(view.onBusyChange).toHaveBeenLastCalledWith(true)
  // 即使外部分发修改事件，也不能清除尚未核实的请求或换一个请求标识。
  fireEvent.change(screen.getByLabelText('退款备注（可选）'), { target: { value: '修正备注' } })
  fireEvent.click(screen.getByRole('button', { name: '确认上次保存结果' }))
  await screen.findByText('退款已登记')
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[1][1]).toEqual(original)
  expect(transactions).toBe(1)
  expect(payment.refunded_minor).toBe(5000)
  expect(within(screen.getByRole('list', { name: '退款历史' })).getAllByRole('listitem')).toHaveLength(2)
})

it('明确校验失败后可继续修正，新内容使用新请求标识', async () => {
  vi.mocked(api.registerLedgerRefund).mockImplementationOnce(async (_id, input) => {
    throw new HttpError('归属已失效', 422, 'refund_not_saved', { request_id: input.request_id })
  })
  fixture(); await begin(); submit()
  await screen.findByText('归属已失效')
  const first = vi.mocked(api.registerLedgerRefund).mock.calls[0][1]
  expect((screen.getByLabelText('退款金额（元）') as HTMLInputElement).readOnly).toBe(false)
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '70.00' } })
  vi.mocked(api.registerLedgerRefund).mockResolvedValueOnce({ payment, refund })
  submit(); await screen.findByText('退款已登记')
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[1][1].amount_minor).toBe(7000)
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[1][1].request_id).not.toBe(first.request_id)
})

it.each([408, 500, 503])('HTTP %s仍保留原请求，必须确认结果才能继续编辑', async status => {
  vi.mocked(api.registerLedgerRefund).mockRejectedValueOnce(new HttpError('暂时无法确认', status, `HTTP_${status}`))
  fixture(); await begin(); submit()
  await screen.findByText('暂时无法确认')
  expect((screen.getByLabelText('退款备注（可选）') as HTMLTextAreaElement).readOnly).toBe(true)
  expect(screen.getByRole('button', { name: '确认上次保存结果' })).toBeTruthy()
  expect((screen.getByRole('button', { name: '放弃退款草稿' }) as HTMLButtonElement).disabled).toBe(true)
})

it('确认原请求时遇到限流仍锁定内容，不会把新的请求标识当成另一笔退款', async () => {
  vi.mocked(api.registerLedgerRefund).mockRejectedValueOnce(new TypeError('响应丢失'))
    .mockRejectedValueOnce(new HttpError('请求受限', 429, 'HTTP_429'))
    .mockResolvedValueOnce({ payment, refund })
  fixture(); await begin(); submit(); await screen.findByText('响应丢失')
  const original = vi.mocked(api.registerLedgerRefund).mock.calls[0][1]
  submit(); await screen.findByText('请求受限')
  expect((screen.getByLabelText('退款备注（可选）') as HTMLTextAreaElement).readOnly).toBe(true)
  expect((screen.getByRole('button', { name: '放弃退款草稿' }) as HTMLButtonElement).disabled).toBe(true)
  submit(); await screen.findByText('退款已登记')
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[2][1]).toEqual(original)
})

it('确认原请求遇到并发冲突，只更新版本并保持原内容和请求标识', async () => {
  const newer = { ...base, version: 4, refundable_minor: 6000, refunded_minor: 4000 }
  vi.mocked(api.registerLedgerRefund).mockRejectedValueOnce(new TypeError('响应丢失'))
    .mockRejectedValueOnce(new HttpError('记录已更新', 409, 'record_version_conflict', { latest_record: newer }))
    .mockResolvedValueOnce({ payment: newer, refund })
  fixture(); await begin()
  fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '30.00' } })
  submit(); await screen.findByText('响应丢失')
  const original = vi.mocked(api.registerLedgerRefund).mock.calls[0][1]
  submit(); await screen.findByRole('region', { name: '核对退款冲突' })
  fireEvent.click(screen.getByRole('button', { name: '已核对，继续确认' }))
  expect((screen.getByLabelText('退款备注（可选）') as HTMLTextAreaElement).readOnly).toBe(true)
  submit(); await screen.findByText('退款已登记')
  expect(vi.mocked(api.registerLedgerRefund).mock.calls[2][1]).toEqual({ ...original, expected_version: 4 })
})

it('已确认删除的请求可结束待确认状态，不会自动重新登记', async () => {
  vi.mocked(api.registerLedgerRefund).mockImplementationOnce(async (_id, input) => {
    throw new HttpError('该退款已被删除', 409, 'refund_request_removed', { request_id: input.request_id })
  })
  fixture(); await begin(); submit(); await screen.findByText('上次退款已被删除，未重新登记。')
  expect(screen.queryByRole('form', { name: '登记退款' })).toBeNull()
  expect(sessionStorage.getItem('ledger:payment:refund')).toBeNull()
  expect(screen.getByRole('button', { name: '登记退款' })).toBeTruthy()
  expect(api.registerLedgerRefund).toHaveBeenCalledOnce()
})

it('退款读取失败可独立重试，全退后不再新建退款', async () => {
  payment = { ...base, refunded_minor: 10000, refundable_minor: 0, refund_state: 'full' }
  vi.mocked(api.listLedgerRefunds).mockRejectedValueOnce(new Error('读取中断'))
  fixture(payment)
  fireEvent.click(await screen.findByRole('button', { name: '重试读取退款' }))
  expect(await screen.findByText('已全退')).toBeTruthy()
  expect((screen.getByRole('button', { name: '登记退款' }) as HTMLButtonElement).disabled).toBe(true)
})

it('HTTP局域网没有randomUUID时仍生成服务端接受的UUID', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  try {
    vi.mocked(api.registerLedgerRefund).mockRejectedValueOnce(new Error('模拟网络失败'))
    fixture(); await begin(); submit()
    await screen.findByText('模拟网络失败')
    expect(vi.mocked(api.registerLedgerRefund).mock.calls[0][1].request_id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor)
    else delete (crypto as Partial<Crypto>).randomUUID
  }
})

it('转写与超长待修正结果阻止保存，收起后仍保留待修正文字', async () => {
  vi.mocked(transcribeAudio).mockResolvedValue({ text: '长'.repeat(10001), duration_ms: 100 })
  const view = fixture(); await begin()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
  expect((screen.getByRole('button', { name: '保存退款' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
  await screen.findByLabelText('待修正的语音结果')
  expect((screen.getByRole('button', { name: '保存退款' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.onBusyChange).toHaveBeenLastCalledWith(true)
  // 关闭详情后重开仍读取原草稿，不丢弃需要人工修正的转写。
  view.unmount(); fixture()
  fireEvent.click(await screen.findByRole('button', { name: '继续退款草稿' }))
  expect((screen.getByLabelText('待修正的语音结果') as HTMLTextAreaElement).value.length).toBe(10001)
  fireEvent.click(screen.getByRole('button', { name: '放弃本次结果' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '保存退款' }) as HTMLButtonElement).disabled).toBe(false))
  expect(api.registerLedgerRefund).not.toHaveBeenCalled()
})
