import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { transcribeAudio } from './api'
import { MAX_RECORDING_MS, startVoiceRecording, type VoiceRecording } from './voiceAudio'

type VoiceStatus = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'done' | 'error'

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return '麦克风权限被拒绝，请在浏览器中允许后重试。'
  if (error instanceof DOMException && error.name === 'NotFoundError') return '未找到可用的麦克风。'
  return error instanceof Error ? error.message : '语音转写失败，请重试。'
}

export function VoiceInput({ active, onTranscript, children }: { active: boolean; onTranscript: (text: string) => void; children: ReactNode }) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [transcribeElapsed, setTranscribeElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [resultDuration, setResultDuration] = useState(0)
  const recording = useRef<VoiceRecording | null>(null)
  const request = useRef<AbortController | null>(null)
  const lastFile = useRef<File | null>(null)
  const generation = useRef(0)
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(active)
  const transcriptRef = useRef(onTranscript)
  activeRef.current = active
  transcriptRef.current = onTranscript

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  const cancel = (update = true) => {
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
      setResultDuration(result.duration_ms)
      setStatus('done')
    } catch (cause) {
      if (generation.current !== current || controller.signal.aborted) return
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

  const seconds = Math.floor(elapsed / 1000)
  const clock = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  return <div className="source-input-wrap"><div className="source-input-field">
    {children}
    <button className={`voice-trigger${status === 'recording' ? ' voice-trigger--recording' : ''}`} type="button" aria-label="开始语音输入" title="开始语音输入" onClick={() => void start()} disabled={!active || status === 'requesting' || status === 'recording' || status === 'transcribing'}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-4 0h8" /></svg>
    </button>
    </div>
    {status !== 'idle' && <div className={`voice-panel voice-panel--${status}`} role="status" aria-live="polite">
      {status === 'requesting' && <><span>正在请求麦克风权限…</span><button type="button" onClick={() => cancel()}>取消</button></>}
      {status === 'recording' && <>
        <span className="voice-wave" aria-hidden="true">{[0.55, 0.82, 1, 0.72, 0.45].map((factor, index) => <i key={index} style={{ height: `${6 + level * factor * 20}px` }} />)}</span>
        <span>录音中 {clock} / 03:00</span>
        <button type="button" onClick={stop}>停止并转写</button><button type="button" onClick={() => cancel()}>取消</button>
      </>}
      {status === 'transcribing' && <><span className="voice-progress" aria-hidden="true" /><span>正在转写 · 已等待 {Math.floor(transcribeElapsed / 1000)} 秒</span><button type="button" onClick={() => cancel()}>取消</button></>}
      {status === 'done' && <span>转写已加入快速记录{Number.isFinite(resultDuration) && resultDuration > 0 ? `（用时 ${(resultDuration / 1000).toFixed(1)} 秒）` : ''}。</span>}
      {status === 'error' && <><span>{error}</span>{lastFile.current && <button type="button" onClick={() => void submit(lastFile.current!, ++generation.current)}>重试转写</button>}</>}
    </div>}
  </div>
}
