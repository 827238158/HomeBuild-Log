import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./voiceAudio', () => ({ MAX_RECORDING_MS: 180_000, startVoiceRecording: vi.fn() }))
vi.mock('./api', () => ({ transcribeAudio: vi.fn() }))

import { VoiceInput } from './VoiceInput'
import { VoiceField } from './VoiceField'
import { transcribeAudio } from './api'
import { startVoiceRecording } from './voiceAudio'
import { HttpError } from './http'

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
  it('静音结束不上传、不改变草稿并恢复保存', async () => {
    finish.mockImplementationOnce(() => { throw new Error('未检测到有效声音，请靠近麦克风重新录制。') })
    render(<form><Harness /><button type="submit">保存</button></form>)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留原文' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect(transcribeAudio).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('保留原文')
    expect(screen.getByText('未检测到有效声音，请靠近麦克风重新录制。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: '重试转写' })).toBeNull()
  })

  it('服务端判定无可识别语音时保留原文并要求重录', async () => {
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new HttpError('未识别到可转写的语音，请重新录制。', 422, 'HTTP_422'))
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留原文' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('保留原文')
    expect(screen.queryByRole('button', { name: '重试转写' })).toBeNull()
  })

  it('不同字段录音互斥，录音期间阻止表单保存', async () => {
    const save = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(<form onSubmit={save}><Harness /><Harness /><button type="submit">保存</button></form>)
    const triggers = screen.getAllByRole('button', { name: '开始语音输入' })
    await act(async () => fireEvent.click(triggers[0]))
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
    expect(save).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(triggers[1]))
    expect(cancelRecording).toHaveBeenCalled()
    expect(screen.getAllByRole('group', { name: '录音控制' })).toHaveLength(1)
  })

  it('超长转写保留可编辑结果，不截断或覆盖原文', async () => {
    function Field() {
      const [value, setValue] = useState('原文')
      return <VoiceField><textarea aria-label="字段" value={value} maxLength={6} onChange={event => setValue(event.target.value)} /></VoiceField>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: '这段文字超过长度', duration_ms: 100 })
    render(<Field />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect((screen.getByRole('textbox', { name: '字段' }) as HTMLTextAreaElement).value).toBe('原文')
    fireEvent.change(screen.getByRole('textbox', { name: '待修正的语音结果' }), { target: { value: '好' } })
    fireEvent.click(screen.getByRole('button', { name: '应用文字' }))
    expect((screen.getByRole('textbox', { name: '字段' }) as HTMLTextAreaElement).value).toBe('原文\n好')
  })
  it('停止后转写，追加到等待期间编辑的草稿且不提交保存', async () => {
    const pending = deferred<{ text: string; duration_ms: number }>()
    vi.mocked(transcribeAudio).mockReturnValue(pending.promise)
    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox', { name: '快速记录' }), { target: { value: '原记录' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    expect(screen.getByRole('group', { name: '录音控制' })).toBeTruthy()
    expect(screen.getByText('00:00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止并转写' }))
    expect(finish).toHaveBeenCalledOnce()
    expect(vi.mocked(transcribeAudio).mock.calls[0][0]).toBe(wav)
    fireEvent.change(screen.getByRole('textbox', { name: '快速记录' }), { target: { value: '原记录，又补充了材料' } })
    await act(async () => pending.resolve({ text: '今天铺了地砖', duration_ms: 1200 }))
    expect((screen.getByRole('textbox', { name: '快速记录' }) as HTMLTextAreaElement).value).toBe('原记录，又补充了材料\n今天铺了地砖')
    expect(screen.getByText('已转写')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '取消录音' }))
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


it('可收起字段保留超长转写结果，重新展开后仍可修正应用', async () => {
  function CollapsibleField() {
    const [open, setOpen] = useState(true)
    const [value, setValue] = useState('原文')
    const [overflow, setOverflow] = useState('')
    return <><button type="button" onClick={() => setOpen(current => !current)}>展开收起</button>{open && <VoiceField overflowDraft={{ text: overflow, onChange: setOverflow }}><textarea aria-label="可收起字段" value={value} maxLength={6} onChange={event => setValue(event.target.value)} /></VoiceField>}</>
  }
  vi.mocked(transcribeAudio).mockResolvedValue({ text: '这段文字超过长度', duration_ms: 100 })
  render(<CollapsibleField />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
  expect((screen.getByRole('textbox', { name: '待修正的语音结果' }) as HTMLTextAreaElement).value).toBe('这段文字超过长度')
  fireEvent.click(screen.getByRole('button', { name: '展开收起' }))
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '展开收起' }))
  expect((screen.getByRole('textbox', { name: '待修正的语音结果' }) as HTMLTextAreaElement).value).toBe('这段文字超过长度')
  fireEvent.change(screen.getByRole('textbox', { name: '待修正的语音结果' }), { target: { value: '好' } })
  fireEvent.click(screen.getByRole('button', { name: '应用文字' }))
  expect((screen.getByRole('textbox', { name: '可收起字段' }) as HTMLTextAreaElement).value).toBe('原文\n好')
})

it('收起正在转写的字段取消请求，迟到结果不覆盖草稿', async () => {
  const pending = deferred<{ text: string; duration_ms: number }>()
  vi.mocked(transcribeAudio).mockReturnValue(pending.promise)
  function CollapsibleField() {
    const [open, setOpen] = useState(true)
    const [value, setValue] = useState('保留草稿')
    return <><button type="button" onClick={() => setOpen(current => !current)}>展开收起</button>{open && <VoiceField><textarea aria-label="可收起字段" value={value} onChange={event => setValue(event.target.value)} /></VoiceField>}</>
  }
  render(<CollapsibleField />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
  fireEvent.click(screen.getByRole('button', { name: '停止并转写' }))
  const signal = vi.mocked(transcribeAudio).mock.calls[0][1]
  fireEvent.click(screen.getByRole('button', { name: '展开收起' }))
  expect(signal?.aborted).toBe(true)
  await act(async () => pending.resolve({ text: '不应追加', duration_ms: 100 }))
  fireEvent.click(screen.getByRole('button', { name: '展开收起' }))
  expect((screen.getByRole('textbox', { name: '可收起字段' }) as HTMLTextAreaElement).value).toBe('保留草稿')
})

describe('VoiceField 单行输入', () => {
  it.each([
    { initial: '已有标题', expected: '已有标题 新标题， 保留标点。' },
    { initial: '', expected: '新标题， 保留标点。' },
  ])('合并转写换行并以空格追加：$initial', async ({ initial, expected }) => {
    function Field() {
      const [value, setValue] = useState(initial)
      return <VoiceField><input aria-label="标题" value={value} onChange={event => setValue(event.target.value)} /></VoiceField>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: ' \r\n新标题，\r\n保留标点。\n ', duration_ms: 100 })
    render(<Field />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe(expected)
  })

  it('多行字段仍按换行追加并保留转写段落', async () => {
    function Field() {
      const [value, setValue] = useState('已有备注')
      return <VoiceField><textarea aria-label="备注" value={value} onChange={event => setValue(event.target.value)} /></VoiceField>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: '第一段\n第二段', duration_ms: 100 })
    render(<Field />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect((screen.getByRole('textbox', { name: '备注' }) as HTMLTextAreaElement).value).toBe('已有备注\n第一段\n第二段')
  })

  it('等待单行转写时编辑标题，结果追加到最新草稿', async () => {
    const pending = deferred<{ text: string; duration_ms: number }>()
    vi.mocked(transcribeAudio).mockReturnValue(pending.promise)
    function Field() {
      const [value, setValue] = useState('旧标题')
      return <VoiceField><input aria-label="标题" value={value} onChange={event => setValue(event.target.value)} /></VoiceField>
    }
    render(<Field />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    fireEvent.click(screen.getByRole('button', { name: '停止并转写' }))
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: '手动修订标题' } })
    await act(async () => pending.resolve({ text: '补充\n材料', duration_ms: 100 }))
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe('手动修订标题 补充 材料')
  })

  it('单行超长转写完整保留，缩短后应用到最新草稿且不截断', async () => {
    function Field() {
      const [value, setValue] = useState('原文')
      return <VoiceField><input aria-label="标题" value={value} maxLength={6} onChange={event => setValue(event.target.value)} /></VoiceField>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: '完整\n超过长度的标题', duration_ms: 100 })
    render(<Field />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe('原文')
    expect((screen.getByRole('textbox', { name: '待修正的语音结果' }) as HTMLTextAreaElement).value).toBe('完整 超过长度的标题')
    fireEvent.click(screen.getByRole('button', { name: '应用文字' }))
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe('原文')
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: '修订' } })
    fireEvent.change(screen.getByRole('textbox', { name: '待修正的语音结果' }), { target: { value: '好\n的' } })
    fireEvent.click(screen.getByRole('button', { name: '应用文字' }))
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe('修订 好 的')
    expect(screen.queryByRole('textbox', { name: '待修正的语音结果' })).toBeNull()
  })

  it('禁用单行字段不会启动录音', async () => {
    render(<VoiceField><input aria-label="标题" value="保留标题" disabled onChange={() => undefined} /></VoiceField>)
    const trigger = screen.getByRole('button', { name: '开始语音输入' }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    await act(async () => fireEvent.click(trigger))
    expect(startVoiceRecording).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe('保留标题')
  })

  it.each(['应用文字', '放弃本次结果'])('超长结果阻止表单保存，%s后恢复', async (action) => {
    const save = vi.fn((event: React.FormEvent) => event.preventDefault())
    function Form() {
      const [value, setValue] = useState('原文')
      return <form onSubmit={save}><VoiceField><input aria-label="标题" value={value} maxLength={6} onChange={event => setValue(event.target.value)} /></VoiceField><button type="submit">保存</button></form>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: '超过剩余长度的标题', duration_ms: 100 })
    render(<Form />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    const form = saveButton.closest('form')!
    expect(saveButton.disabled).toBe(true)
    fireEvent.submit(form)
    expect(save).not.toHaveBeenCalled()
    if (action === '应用文字') fireEvent.change(screen.getByRole('textbox', { name: '待修正的语音结果' }), { target: { value: '好' } })
    fireEvent.click(screen.getByRole('button', { name: action }))
    expect(saveButton.disabled).toBe(false)
    fireEvent.submit(form)
    expect(save).toHaveBeenCalledOnce()
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe(action === '应用文字' ? '原文 好' : '原文')
  })

  it('两个字段共享忙碌回调，最后一个待修正结果解除后才启用保存', async () => {
    function Fields() {
      const [first, setFirst] = useState('甲')
      const [second, setSecond] = useState('乙')
      const [busy, setBusy] = useState(false)
      return <><VoiceField onBusyChange={setBusy}><input aria-label="第一标题" value={first} maxLength={3} onChange={event => setFirst(event.target.value)} /></VoiceField><VoiceField onBusyChange={setBusy}><input aria-label="第二标题" value={second} maxLength={3} onChange={event => setSecond(event.target.value)} /></VoiceField><button type="button" disabled={busy}>保存</button></>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: '保留完整的超长结果', duration_ms: 100 })
    render(<Fields />)
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '开始语音输入' })[0]))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '开始语音输入' })[1]))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(screen.getAllByRole('textbox', { name: '待修正的语音结果' })).toHaveLength(2)
    expect(saveButton.disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: '放弃本次结果' })[0])
    expect(screen.getAllByRole('textbox', { name: '待修正的语音结果' })).toHaveLength(1)
    expect(saveButton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '放弃本次结果' }))
    expect(saveButton.disabled).toBe(false)
  })

  it('同一表单无需忙碌回调，两个待修正结果全部解除后才恢复原生保存按钮', async () => {
    const save = vi.fn((event: React.FormEvent) => event.preventDefault())
    function Form() {
      const [first, setFirst] = useState('甲')
      const [second, setSecond] = useState('乙')
      return <form onSubmit={save}><VoiceField><input aria-label="第一标题" value={first} maxLength={3} onChange={event => setFirst(event.target.value)} /></VoiceField><VoiceField><input aria-label="第二标题" value={second} maxLength={3} onChange={event => setSecond(event.target.value)} /></VoiceField><button type="submit">保存</button><button type="submit" disabled>不可用操作</button></form>
    }
    vi.mocked(transcribeAudio).mockResolvedValue({ text: '保留完整的超长结果', duration_ms: 100 })
    render(<Form />)
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '开始语音输入' })[0]))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '开始语音输入' })[1]))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    const form = saveButton.closest('form')!
    expect(screen.getAllByRole('textbox', { name: '待修正的语音结果' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '放弃本次结果' })[0])
    expect(saveButton.disabled).toBe(true)
    fireEvent.submit(form)
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '放弃本次结果' }))
    expect(saveButton.disabled).toBe(false)
    expect((screen.getByRole('button', { name: '不可用操作' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(form)
    expect(save).toHaveBeenCalledOnce()
  })
})


describe('语音结果焦点与就近反馈', () => {
  it.each(['success', 'error'] as const)('转写%s后将语音工具中的焦点还给所属输入框', async outcome => {
    const pending = deferred<{ text: string; duration_ms: number }>()
    vi.mocked(transcribeAudio).mockReturnValueOnce(pending.promise)
    render(<Harness />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    screen.getByRole('button', { name: /^取消$/ }).focus()
    await act(async () => { if (outcome === 'success') pending.resolve({ text: '新记录', duration_ms: 100 }); else pending.reject(new Error('转写服务暂不可用')) })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '快速记录' }))
    const message = screen.getByText(outcome === 'success' ? '已转写' : '转写服务暂不可用')
    expect(message.closest('.voice-toolbar')).not.toBeNull()
    if (outcome === 'error') expect(screen.getByRole('button', { name: '重试转写' }).closest('.voice-toolbar')).not.toBeNull()
  })

  it('用户已转向外部按钮时完成转写不抢回焦点', async () => {
    const pending = deferred<{ text: string; duration_ms: number }>()
    vi.mocked(transcribeAudio).mockReturnValueOnce(pending.promise)
    render(<><Harness /><button type="button">查看帮助</button></>)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '开始语音输入' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '停止并转写' })))
    const help = screen.getByRole('button', { name: '查看帮助' })
    help.focus()
    await act(async () => pending.resolve({ text: '新记录', duration_ms: 100 }))
    expect(document.activeElement).toBe(help)
    expect((screen.getByRole('textbox', { name: '快速记录' }) as HTMLTextAreaElement).value).toBe('新记录')
  })
})
