import { useRef, useState, type ReactElement, type TextareaHTMLAttributes } from 'react'
import { VoiceInput } from './VoiceInput'
import './VoiceField.css'

/** 字段级语音入口：始终读取最新草稿，超长结果留给用户修正。 */
export function VoiceField({ children, active = true, onBusyChange }: {
  children: ReactElement<TextareaHTMLAttributes<HTMLTextAreaElement>>
  active?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const latest = useRef(children.props)
  latest.current = children.props
  const [pending, setPending] = useState('')
  const apply = (text: string) => {
    const props = latest.current
    const current = String(props.value ?? '')
    const next = current ? `${current}\n${text}` : text
    if (props.maxLength && next.length > props.maxLength) { setPending(text); return }
    props.onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLTextAreaElement>)
    setPending('')
  }
  return <VoiceInput active={active && !children.props.disabled} onTranscript={apply} onBusyChange={onBusyChange}>
    {children}
    {pending && <div className="voice-overflow" role="alert"><p>转写结果超过字段剩余长度，请缩短后应用。原文字已保留。</p><textarea aria-label="待修正的语音结果" value={pending} onChange={event => setPending(event.target.value)} /><button type="button" onClick={() => apply(pending)}>应用文字</button><button type="button" onClick={() => setPending('')}>放弃本次结果</button></div>}
  </VoiceInput>
}
