import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { transcribeAudio } from './api'
import { HttpError } from './http'
import { MAX_RECORDING_MS, startVoiceRecording, type VoiceRecording } from './voiceAudio'
import './VoiceInput.css'

type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'done' | 'error'
// 同一个表单可能同时保留多个待修正结果，按实例汇总状态，避免一个字段解除阻塞后误启用保存。
const busyOwners = new Map<(busy: boolean) => void, Set<symbol>>()
function reportBusy(callback: ((busy: boolean) => void) | undefined, owner: symbol, busy: boolean) {
  if (!callback) return
  const owners = busyOwners.get(callback) ?? new Set<symbol>()
  if (busy) owners.add(owner)
  else owners.delete(owner)
  if (owners.size) busyOwners.set(callback, owners)
  else busyOwners.delete(callback)
  callback(owners.size > 0)
}

type FormLock = { owners: Set<symbol>; buttons: { button: HTMLButtonElement; disabled: boolean }[]; guard: (event: Event) => void }
const formLocks = new WeakMap<HTMLFormElement, FormLock>()
function lockForm(form: HTMLFormElement, owner: symbol) {
  let lock = formLocks.get(form)
  if (!lock) {
    const guard = (event: Event) => { event.preventDefault(); event.stopPropagation() }
    lock = { owners: new Set(), buttons: Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])')).map(button => ({ button, disabled: button.disabled })), guard }
    formLocks.set(form, lock)
    form.addEventListener('submit', guard, true)
  }
  lock.owners.add(owner)
  lock.buttons.forEach(({ button }) => { button.disabled = true })
  return () => {
    lock.owners.delete(owner)
    if (lock.owners.size) { lock.buttons.forEach(({ button }) => { button.disabled = true }); return }
    form.removeEventListener('submit', lock.guard, true)
    lock.buttons.forEach(({ button, disabled }) => { button.disabled = disabled })
    formLocks.delete(form)
  }
}

let cancelVoiceSession: (() => void) | null = null

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限被拒绝，请在浏览器中允许后重试。'
  if (error instanceof DOMException && error.name === 'NotFoundError') return '未找到可用的麦克风。'
  return error instanceof Error ? error.message : '语音转写失败，请重试。'
}

export function VoiceInput({ active, onTranscript, children, feedback, onBusyChange, pendingTranscript = false, label = '语音输入' }: { active: boolean; onTranscript: (text: string) => void; children: ReactNode; feedback?: ReactNode; onBusyChange?: (busy: boolean) => void; pendingTranscript?: boolean; label?: string }) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [transcribeElapsed, setTranscribeElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const recording = useRef<VoiceRecording | null>(null)
  const request = useRef<AbortController | null>(null)
  const lastFile = useRef<File | null>(null)
  const generation = useRef(0)
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(active)
  const transcriptRef = useRef(onTranscript)
  const root = useRef<HTMLDivElement>(null)
  const notifiedBusy = useRef(false)
  const busyOwner = useRef(Symbol())
  const resultFocusOwner = useRef<HTMLElement | null>(null)
  activeRef.current = active
  transcriptRef.current = onTranscript

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  // 只恢复仍停留在本次语音工具上的焦点，不打断用户已转向其他控件的操作。
  const rememberResultFocus = () => {
    const focused = document.activeElement
    resultFocusOwner.current = focused instanceof HTMLElement && root.current?.querySelector('.voice-toolbar')?.contains(focused) ? focused : null
  }
  useLayoutEffect(() => {
    if (status !== 'done' && status !== 'error') return
    const previous = resultFocusOwner.current
    resultFocusOwner.current = null
    if (previous && activeRef.current && (document.activeElement === previous || document.activeElement === document.body)) {
      root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('.source-input-field > input, .source-input-field > textarea')?.focus({ preventScroll: true })
    }
  }, [status])

  const cancel = (update = true) => {
    resultFocusOwner.current = null
    generation.current += 1
    clearTimer()
    recording.current?.cancel()
    recording.current = null
    request.current?.abort()
    request.current = null
    lastFile.current = null
    if (update) { setStatus('idle'); setError(''); setLevel(0); setElapsed(0) }
  }

  useEffect(() => {
    // 待修正结果同样阻止保存，避免未应用的转写随保存而丢失。
    const busy = pendingTranscript || ['requesting', 'recording', 'transcribing'].includes(status)
    if (busy || notifiedBusy.current) reportBusy(onBusyChange, busyOwner.current, busy)
    notifiedBusy.current = busy
    const form = root.current?.closest('form')
    // 表单锁按字段计数，最后一个录音或待修正结果结束后才恢复保存。
    const unlock = busy && form ? lockForm(form, busyOwner.current) : undefined
    return () => { unlock?.(); if (busy) { reportBusy(onBusyChange, busyOwner.current, false); notifiedBusy.current = false } }
  }, [status, onBusyChange, pendingTranscript])

  useEffect(() => {
    const focus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches('textarea, input, select, [role="combobox"]') && !root.current?.contains(event.target)) cancel()
    }
    document.addEventListener('focusin', focus)
    return () => document.removeEventListener('focusin', focus)
  }, [])

  useEffect(() => {
    if (!active) cancel()
  }, [active])
  useEffect(() => () => cancel(false), [])
  useEffect(() => {
    // 页面进入后台或离开时立即释放麦克风，并阻止迟到结果回填。
    const onLeave = () => cancel()
    const onVisibility = () => { if (document.hidden) cancel() }
    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const submit = async (file: File, current: number) => {
    const controller = new AbortController()
    request.current = controller
    clearTimer()
    const submittedAt = performance.now()
    setTranscribeElapsed(0)
    timer.current = setInterval(() => setTranscribeElapsed(performance.now() - submittedAt), 250)
    setStatus('transcribing')
    setError('')
    try {
      const result = await transcribeAudio(file, controller.signal)
      if (generation.current !== current || !activeRef.current || controller.signal.aborted) return
      if (!result.text?.trim()) throw new Error('没有识别到文字，请重试。')
      // 回填由父组件基于最新草稿追加，保留请求等待期间的编辑。
      transcriptRef.current(result.text.trim())
      lastFile.current = null
      rememberResultFocus()
      setStatus('done')
    } catch (cause) {
      if (generation.current !== current || controller.signal.aborted) return
      // 无声或无可识别文字需要重录；重复提交同一段录音没有帮助。
      if (cause instanceof HttpError && cause.status === 422) lastFile.current = null
      rememberResultFocus()
      setError(errorMessage(cause))
      setStatus('error')
    } finally {
      if (generation.current === current) clearTimer()
      if (request.current === controller) request.current = null
    }
  }

  const stop = () => {
    const currentRecording = recording.current
    if (!currentRecording) return
    recording.current = null
    clearTimer()
    setLevel(0)
    const current = generation.current
    try {
      const file = currentRecording.finish()
      lastFile.current = file
      void submit(file, current)
    } catch (cause) {
      setError(errorMessage(cause))
      setStatus('error')
    }
  }

  const start = async () => {
    if (status === 'requesting' || status === 'recording' || status === 'transcribing') return
    if (!window.isSecureContext) {
      setError('当前网页不是可信 HTTPS，浏览器无法使用麦克风。请通过内网 HTTPS 打开。')
      setStatus('error')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setError('当前浏览器不支持页面录音，请使用系统语音输入法。')
      setStatus('error')
      return
    }
    cancelVoiceSession?.()
    cancelVoiceSession = () => cancel()
    const current = ++generation.current
    lastFile.current = null
    setError('')
    setElapsed(0)
    setStatus('requesting')
    try {
      const next = await startVoiceRecording(setLevel, () => { if (generation.current === current) stop() })
      if (generation.current !== current || !activeRef.current) { next.cancel(); return }
      recording.current = next
      startedAt.current = performance.now()
      timer.current = setInterval(() => {
        const ms = performance.now() - startedAt.current
        setElapsed(Math.min(MAX_RECORDING_MS, ms))
        if (ms >= MAX_RECORDING_MS) stop()
      }, 250)
      setStatus('recording')
    } catch (cause) {
      if (generation.current !== current) return
      setError(errorMessage(cause))
      setStatus('error')
    }
  }

  const retry = () => {
    const file = lastFile.current
    if (!file) return
    // 重试同样占用全局会话，避免与另一字段的转写并发回填。
    cancelVoiceSession?.()
    lastFile.current = file
    cancelVoiceSession = () => cancel()
    void submit(file, ++generation.current)
  }

  const seconds = Math.floor(elapsed / 1000)
  const clock = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  return <div ref={root} className="source-input-wrap" data-voice-status={status}><div className="source-input-field">
    {children}
    <div className="voice-toolbar">
    {/* 成功与错误复用已预留的工具行，避免提示出现时推动下一项。 */}
    {(status === 'done' || status === 'error') && <div className={`voice-panel voice-panel--${status}`} role="status" aria-live="polite">
      <span>{status === 'done' ? '已转写' : error}</span>
    </div>}
    {status === 'recording' ? <div className="voice-capsule" role="group" aria-label="录音控制">
      {/* 复用录音服务提供的真实音量；胶囊只负责展示与操作，不创建第二条音频流。 */}
      <span className="voice-capsule__wave" aria-hidden="true">{[0.55, 0.82, 1, 0.72, 0.45].map((factor, index) => <i key={index} style={{ transform: `scaleY(${(3 + level * factor * 11) / 14})` }} />)}</span>
      <span className="voice-capsule__clock" aria-hidden="true">{clock}</span>
      <button className="voice-capsule__stop" type="button" onClick={stop} aria-label="停止并转写"><span aria-hidden="true" />停止</button>
      <button className="voice-capsule__cancel" type="button" onClick={() => cancel()} aria-label="取消录音">取消</button>
      <span className="sr-only" role="status">录音中，最长 3 分钟</span>
    </div> : status === 'requesting' || status === 'transcribing' ? <div className="voice-capsule voice-capsule--waiting" role="status" aria-live="polite">
      <span className="voice-progress" aria-hidden="true" />
      <span className="voice-wait-label">{status === 'requesting' ? '等待麦克风权限…' : `转写中 · ${Math.floor(transcribeElapsed / 1000)} 秒`}</span>
      <button className="voice-capsule__cancel" type="button" onClick={() => cancel()}>取消</button>
    </div> : <div className="voice-idle-actions">
    {status === 'error' && lastFile.current && <button type="button" onClick={retry}>重试转写</button>}
    <button className="voice-trigger" type="button" aria-label={`开始${label}`} title={`开始${label}`} onClick={() => void start()} disabled={!active}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="2.5" width="6" height="12.5" rx="3" /><path d="M5 10.5v1a7 7 0 0 0 14 0v-1M12 18.5V22m-4 0h8" /></svg>
    </button></div>}
    </div>
    </div>
    {feedback}
  </div>
}
