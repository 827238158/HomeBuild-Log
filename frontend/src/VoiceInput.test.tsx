import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./voiceAudio', () => ({ MAX_RECORDING_MS: 180_000, startVoiceRecording: vi.fn() }))
vi.mock('./api', () => ({ transcribeAudio: vi.fn() }))

import { VoiceInput } from './VoiceInput'
import { transcribeAudio } from './api'
import { startVoiceRecording } from './voiceAudio'

const wav = new File(['wav'], 'recording.wav', { type: 'audio/wav' })
const finish = vi.fn(() => wav)
const cancelRecording = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function Harness({ active = true }: { active?: boolean }) {
  const [text, setText] = useState('')
  return <VoiceInput active={active} onTranscript={(value) => setText((current) => current ? `${current}\n${value}` : value)}>
    <textarea aria-label="快速记录" value={text} onChange={(event) => setText(event.target.value)} />
  </VoiceInput>
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
  vi.stubGlobal('AudioContext', vi.fn())
  vi.mocked(startVoiceRecording).mockResolvedValue({ finish, cancel: cancelRecording })
})

describe('VoiceInput', () => {
  it('停止后转写，追加到等待期间编辑的草稿且不提交保存', async () => {
    const pending = deferred<{ text: string; duration_ms: number }>()
    vi.mocked(transcribeAudio).mockReturnValue(pending.promise)
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: '快速记录' }), { target: { value: '原记录' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    fireEvent.click(screen.getByRole('button', { name: '停止并转写' }))
    expect(finish).toHaveBeenCalledOnce()
    expect(vi.mocked(transcribeAudio).mock.calls[0][0]).toBe(wav)
    fireEvent.change(screen.getByRole('textbox', { name: '快速记录' }), { target: { value: '原记录，又补充了材料' } })
    await act(async () => pending.resolve({ text: '今天铺了地砖', duration_ms: 1200 }))
    expect((screen.getByRole('textbox', { name: '快速记录' }) as HTMLTextAreaElement).value).toBe('原记录，又补充了材料\n今天铺了地砖')
    expect(screen.getByText(/转写已加入快速记录/)).toBeTruthy()
  })

  it('切换标签后停止录音，并忽略迟到的转写结果', async () => {
    const pending = deferred<{ text: string; duration_ms: number }>()
    vi.mocked(transcribeAudio).mockReturnValue(pending.promise)
    const view = render(<Harness />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    fireEvent.click(screen.getByRole('button', { name: '停止并转写' }))
    const signal = vi.mocked(transcribeAudio).mock.calls[0][1]
    view.rerender(<Harness active={false} />)
    expect(signal?.aborted).toBe(true)
    await act(async () => pending.resolve({ text: '不应出现', duration_ms: 100 }))
    expect((screen.getByRole('textbox', { name: '快速记录' }) as HTMLTextAreaElement).value).toBe('')
    view.rerender(<Harness />)
    expect(screen.getByRole('button', { name: '开始语音输入' }).hasAttribute('disabled')).toBe(false)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(cancelRecording).toHaveBeenCalled()
    expect(transcribeAudio).toHaveBeenCalledOnce()
  })

  it('转写失败保留录音，重试后只追加一次', async () => {
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('转写服务暂不可用')).mockResolvedValueOnce({ text: '重试成功', duration_ms: 300 })
    render(<Harness />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect(screen.getByText('转写服务暂不可用')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试转写' })))
    expect((screen.getByRole('textbox', { name: '快速记录' }) as HTMLTextAreaElement).value).toBe('重试成功')
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
  })
})
