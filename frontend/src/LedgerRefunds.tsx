import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listLedgerRefunds, registerLedgerRefund, listSpaces, listEntities, type LedgerRefundInput, type LedgerRefundList, type ProjectionRecord, type NamedEntity, type SpaceEntry } from './domainApi'
import { ArchivePicker } from './ArchiveFields'
import { VoiceField } from './VoiceField'
import { conflictRecord } from './RecordConflict'
import { useNavigationGuard } from './navigationGuard'
import { HttpError } from './http'
import { beijingToday, formatCalendarDate } from './time'
import { formatMoney } from './currency'
import './LedgerRefunds.css'

interface RefundDraft {
  amount: string; date: string; description: string; version: number
  requestId: string; spaceIds: string[]; stageId: string; overflow: string; submitted: boolean
  submittedInput?: LedgerRefundInput
}
const errorMessage = (failure: unknown) => failure instanceof TypeError && /fetch|network|load failed/i.test(failure.message)
  ? '连接失败，请检查网络后重试。'
  : failure instanceof Error ? failure.message : '退款保存失败，请重试。'
const storageKey = (id: string) => `ledger:${id}:refund`
function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // 局域网 HTTP 不一定提供 randomUUID，仍使用浏览器随机源生成标准 UUID。
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function readDraft(id: string): RefundDraft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as RefundDraft | null
    return draft && typeof draft.amount === 'string' && typeof draft.date === 'string' && typeof draft.description === 'string'
      && typeof draft.version === 'number' && typeof draft.requestId === 'string' && Array.isArray(draft.spaceIds)
      && typeof draft.stageId === 'string' ? { ...draft, overflow: draft.overflow ?? '', submitted: draft.submitted === true } : null
  } catch { return null }
}

export function LedgerRefunds({ record, active = true, onPaymentChanged, onOpen, onBusyChange, onCountChange }: {
  record: ProjectionRecord; active?: boolean; onPaymentChanged: (payment: ProjectionRecord) => void
  onOpen: (id: string) => void; onBusyChange: (busy: boolean) => void; onCountChange: (count: number) => void
}) {
  const [data, setData] = useState<LedgerRefundList | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RefundDraft | null>(() => readDraft(record.id))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [latestConflict, setLatestConflict] = useState<ProjectionRecord | null>(null)
  const [options, setOptions] = useState<{ spaces: SpaceEntry[]; stages: NamedEntity[] }>({ spaces: [], stages: [] })
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const [optionsAttempt, setOptionsAttempt] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const payment = latestConflict ?? data?.payment ?? record
  const missingSpace = !payment.space_ids?.length
  const missingStage = !payment.stage_id
  const hasBalance = typeof payment.refundable_minor === 'number' && payment.refundable_minor > 0
  const eligible = payment.status === 'paid' && !payment.archived_at && hasBalance
  const canSubmit = eligible || !!draft?.submitted
  const pendingResult = !!draft?.submitted
  useNavigationGuard(!!draft || busy, busy ? '退款正在保存，离开后请先核对退款历史，避免重复登记。' : pendingResult ? '上次退款结果尚未确认，离开后请回到原付款确认保存结果，确定离开吗？' : '退款草稿尚未保存，离开后可回到原付款继续填写，确定离开吗？')
  useEffect(() => {
    // 请求标识随草稿保存；网络结果不明确时重试同一笔退款，不生成第二条流水。
    try {
      if (draft) sessionStorage.setItem(storageKey(record.id), JSON.stringify(draft))
      else sessionStorage.removeItem(storageKey(record.id))
    } catch { /* 存储不可用时保留当前表单。 */ }
  }, [draft, record.id])
  useEffect(() => {
    onBusyChange(busy || voiceBusy || pendingResult)
    return () => onBusyChange(false)
  }, [busy, voiceBusy, pendingResult, onBusyChange])
  useEffect(() => {
    let current = true
    setLoading(true); setLoadError('')
    listLedgerRefunds(record.id).then(value => {
      if (!current) return
      setData(value); onCountChange(value.items.length)
    }).catch(failure => { if (current) setLoadError(errorMessage(failure)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [record.id, record.version, attempt, onCountChange])
  useEffect(() => {
    if (!open || (!missingSpace && !missingStage)) return
    let current = true
    setOptionsLoading(true); setOptionsError('')
    Promise.all([missingSpace ? listSpaces() : Promise.resolve([]), missingStage ? listEntities('stages') : Promise.resolve([])])
      .then(([spaces, stages]) => { if (current) setOptions({ spaces, stages }) })
      .catch(failure => { if (current) setOptionsError(errorMessage(failure)) })
      .finally(() => { if (current) setOptionsLoading(false) })
    return () => { current = false }
  }, [open, missingSpace, missingStage, optionsAttempt])
  useEffect(() => {
    if (open && active) formRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [open, active])
  const change = <K extends keyof RefundDraft>(field: K, value: RefundDraft[K]) => {
    // 结果不明时先确认原请求，不能把修改备注变成第二笔退款。
    if (pendingResult) return
    setDraft(current => current && !current.submitted ? { ...current, [field]: value, requestId: requestId(), submitted: false, submittedInput: undefined } : current)
    setError(''); setSuccess('')
  }
  const begin = () => {
    if (!draft) setDraft({ amount: ((payment.refundable_minor ?? 0) / 100).toFixed(2), date: beijingToday(), description: '', version: Number(payment.version), requestId: requestId(), spaceIds: [], stageId: '', overflow: '', submitted: false })
    setOpen(true); setSuccess('')
  }
  const close = () => { setOpen(false); requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true })) }
  const restoreFocus = () => requestAnimationFrame(() => {
    // 全退后登记入口禁用，键盘焦点转到退款历史，避免落到页面背景。
    const target = toggleRef.current
    if (target && !target.disabled) target.focus({ preventScroll: true })
    else (sectionRef.current?.querySelector<HTMLButtonElement>('.ledger-refunds__history button') ?? sectionRef.current)?.focus({ preventScroll: true })
  })
  const clearDraft = () => {
    // 成功或放弃时立即清除持久草稿，避免详情随即卸载后仍留下已完成的请求。
    try { sessionStorage.removeItem(storageKey(record.id)) } catch { /* 本页状态仍正常清理。 */ }
    setDraft(null)
  }
  const discard = () => {
    if (busyRef.current || pendingResult) return
    if (!window.confirm('确定放弃本次退款草稿吗？')) return
    clearDraft(); setError(''); setLatestConflict(null); close()
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft || busyRef.current || voiceBusy || draft.overflow || latestConflict) return
    const [yuan, cents = ''] = draft.amount.split('.')
    const amount = Number(yuan) * 100 + Number(cents.padEnd(2, '0'))
    if (!/^\d+(\.\d{1,2})?$/.test(draft.amount) || !Number.isSafeInteger(amount) || amount <= 0) { setError('请填写大于零的退款金额，最多两位小数。'); return }
    // 已发送但结果不明的草稿允许幂等重试，即使最新余额已包含这笔退款。
    if (!draft.submitted && amount > (payment.refundable_minor ?? 0)) { setError('退款金额不能超过剩余可退金额。'); return }
    if (!draft.date) { setError('请填写退款日期。'); return }
    if (!draft.submitted && missingSpace && !draft.spaceIds.length) { setError('请选择至少一个空间。'); return }
    if (!draft.submitted && missingStage && !draft.stageId) { setError('请选择装修阶段。'); return }
    const payload: LedgerRefundInput = draft.submitted && draft.submittedInput ? draft.submittedInput : {
      amount_minor: amount, refund_date: draft.date, description: draft.description.trim() || null,
      expected_version: draft.version, request_id: draft.requestId,
      ...(missingSpace ? { space_ids: draft.spaceIds } : {}), ...(missingStage ? { stage_id: draft.stageId } : {}),
    }
    busyRef.current = true; setBusy(true); setError(''); setSuccess('')
    setDraft(current => current ? { ...current, submitted: true, submittedInput: payload } : current)
    try {
      const result = await registerLedgerRefund(record.id, payload)
      clearDraft(); setLatestConflict(null); setOpen(false); setSuccess('退款已登记')
      setData(current => ({ payment: result.payment, items: [...(current?.items.filter(item => item.id !== result.refund.id) ?? []), result.refund], excluded_topic_names: current?.excluded_topic_names ?? [] }))
      onPaymentChanged(result.payment); setAttempt(value => value + 1)
      restoreFocus()
    } catch (failure) {
      // 代理限流或一次重试被拒绝，不能证明原请求未保存；只信服务端对同一请求的回执。
      const receipt = failure instanceof HttpError ? failure.detail as { request_id?: string } | undefined : undefined
      if (failure instanceof HttpError && failure.code === 'refund_request_removed' && receipt?.request_id === payload.request_id) {
        // 原退款已明确删除，结束旧请求，不能让旧标识在保存按钮里反复重试。
        clearDraft(); setOpen(false); setLatestConflict(null); setError('')
        setSuccess('上次退款已被删除，未重新登记。'); setAttempt(value => value + 1); restoreFocus()
        return
      }
      const confirmedNotSaved = failure instanceof HttpError && failure.code === 'refund_not_saved' && receipt?.request_id === payload.request_id
      if (confirmedNotSaved) {
        setDraft(current => current ? { ...current, submitted: false, submittedInput: undefined } : current)
      }
      const latest = conflictRecord(failure)
      if (latest) { setLatestConflict(latest); setAttempt(value => value + 1) }
      else if (!confirmedNotSaved) setAttempt(value => value + 1)
      setError(errorMessage(failure))
    } finally { busyRef.current = false; setBusy(false) }
  }
  const refundLabel = { none: '未退款', partial: '部分退款', full: '已全退' }[payment.refund_state ?? 'none']
  const archiveDisabled = !active || busy || pendingResult || optionsLoading || !!optionsError
  return <section ref={sectionRef} tabIndex={-1} className="ledger-refunds" aria-label="付款退款记录" hidden={!active}>
    <h4>退款</h4>
    {data && <dl className="detail-list"><div><dt>退款状态</dt><dd>{refundLabel}</dd></div><div><dt>累计退款</dt><dd>{formatMoney(payment.refunded_minor ?? 0)}</dd></div><div><dt>剩余可退</dt><dd>{formatMoney(payment.refundable_minor ?? 0)}</dd></div></dl>}
    {loading && <p role="status">正在读取退款记录…</p>}
    {loadError && <p role="alert">{loadError} <button className="secondary-button" type="button" onClick={() => setAttempt(value => value + 1)}>重试读取退款</button></p>}
    {success && <p role="status">{success}</p>}
    {data && <>
      <div className="detail-record-actions"><button ref={toggleRef} className="secondary-button" type="button" disabled={busy || voiceBusy || (!eligible && !draft)} aria-expanded={open} onClick={() => open ? close() : begin()}>{open ? '收起退款表单' : pendingResult ? '确认上次退款' : draft ? '继续退款草稿' : '登记退款'}</button></div>
      {open && draft && <form ref={formRef} onSubmit={event => void save(event)} aria-label="登记退款" className="ledger-refunds__form">
        {pendingResult && !busy && <p className="ledger-refunds__pending" role="status">上次退款是否已保存还不确定。请先确认保存结果，再修改内容或登记另一笔。</p>}
        <fieldset className="record-form-grid" disabled={busy}>
          <label className="field-stack"><span>退款金额（元）</span><input required readOnly={pendingResult} inputMode="decimal" value={draft.amount} onChange={event => change('amount', event.target.value)} /></label>
          <label className="field-stack"><span>退款日期</span><input required readOnly={pendingResult} type="date" value={draft.date} onChange={event => change('date', event.target.value)} /></label>
          <label className="field-stack record-form-grid__wide"><span>退款备注（可选）</span><VoiceField active={active && open && !busy && !latestConflict && !pendingResult} onBusyChange={setVoiceBusy} overflowDraft={{ text: draft.overflow, onChange: value => change('overflow', value) }}><textarea rows={3} maxLength={10000} readOnly={pendingResult} value={draft.description} onChange={event => change('description', event.target.value)} /></VoiceField></label>
          {(missingSpace || missingStage) && <p className="muted record-form-grid__wide">原付款缺少归属，请为本次退款补齐。原付款保持不变。</p>}
          {missingSpace && <ArchivePicker type="spaces" label="空间" required value={draft.spaceIds} options={options.spaces} onChange={ids => change('spaceIds', ids)} disabled={archiveDisabled} />}
          {missingStage && <ArchivePicker type="stages" label="装修阶段" required value={draft.stageId} options={options.stages} onChange={ids => change('stageId', ids[0] ?? '')} disabled={archiveDisabled} />}
          {optionsLoading && <p className="record-form-grid__wide" role="status">正在读取归属选项…</p>}
          {optionsError && <p className="record-form-grid__wide" role="alert">{optionsError} <button type="button" className="secondary-button" onClick={() => setOptionsAttempt(value => value + 1)}>重试归属选项</button></p>}
          {!!data.excluded_topic_names.length && <p className="muted record-form-grid__wide">以下主题已归档，本次退款不会自动加入：{data.excluded_topic_names.join('、')}。如需关联，请先恢复主题。</p>}
          <div className="record-actions record-form-grid__wide"><button className="primary-button" type="submit" disabled={busy || voiceBusy || !!draft.overflow || !!latestConflict || ((!pendingResult) && (optionsLoading || !!optionsError)) || !canSubmit}>{busy ? '处理中…' : pendingResult ? '确认上次保存结果' : '保存退款'}</button><button className="secondary-button" type="button" disabled={busy || voiceBusy || pendingResult} onClick={discard}>放弃退款草稿</button></div>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {latestConflict && <div className="ledger-refunds__conflict" role="region" aria-label="核对退款冲突"><p>原付款或退款记录已更新，当前剩余可退 {formatMoney(latestConflict.refundable_minor ?? 0)}。核对后继续确认同一笔退款，已填写内容保持不变。</p><button type="button" className="secondary-button" onClick={() => {
          setDraft(current => current ? { ...current, version: Number(latestConflict.version), submittedInput: current.submittedInput ? { ...current.submittedInput, expected_version: Number(latestConflict.version) } : undefined } : current)
          setLatestConflict(null); setError(''); onPaymentChanged(latestConflict)
        }}>已核对，继续确认</button></div>}
      </form>}
      {!!data.items.length && <ol className="ledger-refunds__history" aria-label="退款历史">{data.items.map(item => <li key={item.id}><button className="ledger-refunds__entry" type="button" onClick={() => onOpen(item.id)}><span>{formatCalendarDate(item.occurred_date)}{item.status === 'voided' ? ' · 已作废' : ''}</span><strong>{formatMoney(item.amount_minor ?? 0)}</strong><span className="ledger-refunds__note">{item.description?.trim() || '未填写备注'}</span><span className="muted">查看退款详情</span></button></li>)}</ol>}
    </>}
  </section>
}
