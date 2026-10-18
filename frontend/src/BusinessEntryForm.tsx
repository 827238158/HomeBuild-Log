import { VoiceField } from './VoiceField'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createDirectRecord, createEntity, listEntities, type NamedEntity } from './domainApi'
import { RecordAssociations, useAssociationOptions } from './RecordAssociations'
import { TopicSelect } from './TopicSelect'
import { Select } from './Select'
import { useNavigationGuard } from './navigationGuard'
import { completedStatusForLedgerKind } from './recordConfig'
import { beijingToday } from './time'
import './BusinessEntryForm.css'

interface Props { kind: 'ledger' | 'issue'; onSaved: () => void; initialTopicId?: string; title?: string }
const emptyDraft = () => ({ title: '', date: beijingToday(), description: '', ledgerKind: 'payment', amount: '', paymentKind: '', vendor: '', severity: 'medium', plan: '', due_date: '' })

export function BusinessEntryForm({ kind, onSaved, initialTopicId, title }: Props) {
  const [open, setOpen] = useState(!!initialTopicId)
  const [topicIds, setTopicIds] = useState<string[]>(initialTopicId ? [initialTopicId] : [])
  const [associations, setAssociations] = useState<Record<string, unknown>>({})
  const associationOptions = useAssociationOptions(open)
  const [draft, setDraft] = useState(emptyDraft)
  const [entities, setEntities] = useState<NamedEntity[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [newVendor, setNewVendor] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const dirty = Object.keys(associations).length > 0 || JSON.stringify(topicIds) !== JSON.stringify(initialTopicId ? [initialTopicId] : []) || JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || !!newVendor.trim()
  useNavigationGuard(dirty || busy)
  const change = (key: keyof typeof draft, value: string) => { setDraft(current => ({ ...current, [key]: value })); setSuccess('') }
  useEffect(() => {
    if (!open || kind !== 'ledger') return
    let active = true
    setLoading(true); setLoadError('')
    listEntities('vendors').then(rows => {
      if (active) setEntities(rows)
    }).catch(reason => { if (active) setLoadError(reason instanceof Error ? reason.message : '选项加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [kind, open, retry])

  async function addVendor() {
    if (!newVendor.trim() || busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const item = await createEntity('vendors', { name: newVendor.trim() })
      setEntities(current => [...current, item]); change('vendor', item.id); setNewVendor('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新增交易对象失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    setError(''); setSuccess('')
    if (!draft.title.trim() || !draft.date) { setError('请填写标题和发生日期'); return }
    if (kind === 'issue' && !draft.description.trim()) { setError('请填写事项内容'); return }
    // 金额先验证小数位，再转换为分，避免静默四舍五入用户输入。
    const [yuan, cents = ''] = draft.amount.split('.')
    const amount = Number(yuan) * 100 + Number(cents.padEnd(2, '0'))
    if (kind === 'ledger' && (!/^\d+(\.\d{1,2})?$/.test(draft.amount) || !Number.isSafeInteger(amount) || amount <= 0 || !draft.vendor || !draft.paymentKind.trim())) {
      setError('请填写交易对象、款项性质和大于零的金额（最多两位小数）'); return
    }
    const payload = {
      ...associations, topic_ids: topicIds, record_type: kind, title: draft.title.trim(), occurred_date: draft.date,
      description: draft.description.trim() || null, timezone: 'Asia/Shanghai',
      ...(kind === 'ledger' ? {
        ledger_kind: draft.ledgerKind, direction: draft.ledgerKind === 'payment' ? 'expense' : draft.ledgerKind,
        status: completedStatusForLedgerKind(draft.ledgerKind), currency: 'CNY', amount_minor: amount,
        payment_kind: draft.paymentKind.trim(), vendor_id: draft.vendor, payment_date: draft.date,
      } : {
        status: 'pending', phenomenon: draft.description.trim(), severity: draft.severity,
        handling_plan: draft.plan.trim() || null, due_date: draft.due_date || null, participant_ids: associations.participant_ids ?? [],
      }),
    }
    busyRef.current = true; setBusy(true)
    try {
      // 来源与正式记录由服务端一次提交，成功前始终保留本页草稿。
      await createDirectRecord(payload)
      setAssociations({}); setDraft(emptyDraft()); setTopicIds(initialTopicId ? [initialTopicId] : []); setNewVendor(''); setOpen(false)
      setSuccess(kind === 'ledger' ? '账目已保存' : '待办与问题已保存')
      onSaved()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试') }
    finally { busyRef.current = false; setBusy(false) }
  }

  return <section className={`business-entry${title ? ' business-entry--page' : ''}`} aria-label={kind === 'ledger' ? '直接记账' : '直接登记事项'}>
    <header className="business-page-header">{title && <h2>{title}</h2>}<button className="business-entry-toggle" type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}>{open ? '收起' : kind === 'ledger' ? '记一笔账' : '新增待办或问题'}</button></header>
    {success && <p role="status">{success}</p>}
    {open && <form onSubmit={save}>
      <fieldset disabled={busy} className="business-entry-fields">
        <label className="field-stack business-entry-wide"><span>{kind === 'ledger' ? '账目名称' : '事项标题'}</span><input required maxLength={300} value={draft.title} onChange={event => change('title', event.target.value)} placeholder={kind === 'ledger' ? '例如：购买厨房灯带' : '例如：联系师傅确认安装时间'} /></label>
        <label className="field-stack"><span>发生日期</span><input required type="date" value={draft.date} onChange={event => change('date', event.target.value)} /></label>
        {kind === 'ledger' ? <>
          <label className="field-stack"><span>账目类型</span><Select disabled={busy} value={draft.ledgerKind} onChange={event => change('ledgerKind', event.target.value)}><option value="payment">付款</option><option value="refund">退款</option><option value="income">收入</option></Select></label>
          <label className="field-stack"><span>金额（元）</span><input required inputMode="decimal" value={draft.amount} onChange={event => change('amount', event.target.value)} placeholder="0.00" /></label>
          <label className="field-stack"><span>款项性质</span><input required value={draft.paymentKind} onChange={event => change('paymentKind', event.target.value)} placeholder="例如：全款、预付款、尾款" /></label>
          <label className="field-stack business-entry-wide"><span>交易对象（收付款方）</span><Select required disabled={loading || busy} value={draft.vendor} onChange={event => change('vendor', event.target.value)}><option value="">{loading ? '加载中…' : '请选择交易对象'}</option>{entities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <div className="business-entry-wide business-entry-inline"><label className="field-stack"><span>新增交易对象（可选）</span><input value={newVendor} onChange={event => setNewVendor(event.target.value)} placeholder="交易对象名称" /></label><button className="secondary-button" type="button" disabled={!newVendor.trim() || busy || loading} onClick={() => void addVendor()}>添加并选中</button></div>
        </> : <>
          <label className="field-stack"><span>截止日期（可选）</span><input type="date" value={draft.due_date} onChange={event => change('due_date', event.target.value)} /></label><label className="field-stack"><span>严重程度</span><Select disabled={busy} value={draft.severity} onChange={event => change('severity', event.target.value)}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></Select></label>
        </>}
        {loadError && <div className="business-entry-wide" role="alert">选项加载失败：{loadError} <button type="button" onClick={() => setRetry(value => value + 1)}>重试加载</button></div>}
        <label className="field-stack business-entry-wide"><span>{kind === 'ledger' ? '备注（可选）' : '事项内容'}</span><VoiceField active={open && !busy}><textarea required={kind === 'issue'} rows={3} maxLength={10000} value={draft.description} onChange={event => change('description', event.target.value)} /></VoiceField></label>
        {kind === 'issue' && <label className="field-stack business-entry-wide"><span>处理计划（可选）</span><VoiceField active={open && !busy}><textarea rows={2} maxLength={10000} value={draft.plan} onChange={event => change('plan', event.target.value)} /></VoiceField></label>}
        <div className="business-entry-wide"><TopicSelect value={topicIds} onChange={setTopicIds} disabled={busy} /></div>
        <div className="business-entry-wide">
          <RecordAssociations payload={{ ...associations, topic_ids: topicIds }} onChange={(key, value) => setAssociations(current => ({ ...current, [key]: value }))} entities={associationOptions.entities} records={associationOptions.records} participantLabel={kind === 'issue' ? '处理人' : '相关人员'} disabled={busy} loading={associationOptions.loading} optionsError={associationOptions.error} onRetry={associationOptions.retry} error={/空间|材料|阶段|人员|关联|space|material|participant|stage|related/i.test(error) ? error : undefined} />
        </div>
        <div className="business-entry-wide"><button type="submit" disabled={busy || (kind === 'ledger' && loading)}>{busy ? '保存中…' : kind === 'ledger' ? '保存账目' : '保存事项'}</button></div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>}
  </section>
}
