import { useRef, useState, type ChangeEvent, type ReactElement, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { VoiceInput } from './VoiceInput'
import './VoiceField.css'

/** 字段级语音入口：始终读取最新草稿，超长结果留给用户修正。 */
export function VoiceField({ children, active = true, onBusyChange, overflowDraft }: {
  children: ReactElement<TextareaHTMLAttributes<HTMLTextAreaElement>> | ReactElement<InputHTMLAttributes<HTMLInputElement>>
  active?: boolean
  onBusyChange?: (busy: boolean) => void
  overflowDraft?: { text: string; onChange: (text: string) => void }
}) {
  const latest = useRef(children)
  latest.current = children
  const [localPending, setLocalPending] = useState('')
  // 可收起表单由父级保留超长转写草稿，避免卸载输入控件后丢失。
  const pending = overflowDraft?.text ?? localPending
  const setPending = overflowDraft?.onChange ?? setLocalPending
  const apply = (text: string) => {
    const field = latest.current
    const props = field.props
    // 单行输入合并转写换行，继续向最新草稿追加，不覆盖等待期间的编辑。
    const singleLine = field.type === 'input'
    const transcript = singleLine ? text.replace(/[\r\n]+/g, ' ').trim() : text
    const current = String(props.value ?? '')
    const next = current ? `${current}${singleLine ? ' ' : '\n'}${transcript}` : transcript
    if (props.maxLength && next.length > props.maxLength) { setPending(transcript); return }
    props.onChange?.({ target: { value: next } } as ChangeEvent<HTMLTextAreaElement> & ChangeEvent<HTMLInputElement>)
    setPending('')
  }
  return <VoiceInput active={active && !children.props.disabled} onTranscript={apply} onBusyChange={onBusyChange} pendingTranscript={!!pending}
    feedback={pending && <div className="voice-overflow" role="alert"><p>转写结果超过字段剩余长度，请缩短后应用。原文字已保留。</p><textarea aria-label="待修正的语音结果" value={pending} onChange={event => setPending(event.target.value)} /><button className="primary-button" type="button" onClick={() => apply(pending)}>应用文字</button><button className="secondary-button" type="button" onClick={() => setPending('')}>放弃本次结果</button></div>}>
    {children}
  </VoiceInput>
}
