import { describe, expect, it } from 'vitest'

import { encodeWav, hasAudibleAudio, NO_AUDIO_MESSAGE, startVoiceRecording } from './voiceAudio'
import { vi } from 'vitest'

describe('encodeWav', () => {
  it('将不同块的 48 kHz 采样编码为 16 kHz 单声道 PCM WAV', () => {
    const bytes = encodeWav([new Float32Array([0, 0.2, 0.4]), new Float32Array([0.6, 0.8, 1])], 6, 48_000)
    const view = new DataView(bytes)
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(40, true)).toBe(4)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBeGreaterThan(0)
  })
})

// 使用合成波形验证边界；真实麦克风的轻声与底噪仍需实机校准。
function signal(amplitude: number, seconds = 1, offset = 0) {
  return Float32Array.from({ length: Math.round(16000 * seconds) }, (_, index) => offset + amplitude * Math.sin(2 * Math.PI * 200 * index / 16000))
}

describe('静音门控', () => {
  it.each([
    ['纯静音', signal(0), false],
    ['近静音', signal(0.0005), false],
    ['设备直流偏移', signal(0, 1, 0.05), false],
    ['短脉冲', signal(0.5, 0.02), false],
    ['不足120ms', signal(0.1, 0.1), false],
    ['轻声有效音', signal(0.002), true],
    ['120ms有效音', signal(0.1, 0.12), true],
    ['正常音量', signal(0.2), true],
  ])('%s', (_, samples, expected) => {
    expect(hasAudibleAudio(encodeWav([samples], samples.length, 16000))).toBe(expected)
  })

  it('短有效声音前后有长静音仍可提交', () => {
    const chunks = [signal(0, 10), signal(0.002, 0.2), signal(0, 10)]
    expect(hasAudibleAudio(encodeWav(chunks, chunks.reduce((sum, chunk) => sum + chunk.length, 0), 16000))).toBe(true)
  })

  it('结束静音录制时拒绝产生文件并释放麦克风', async () => {
    const stopTrack = vi.fn()
    const processor = { onaudioprocess: null as null | ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void), connect: vi.fn(), disconnect: vi.fn() }
    const context = { sampleRate: 16000, createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }), createScriptProcessor: () => processor, destination: {}, resume: vi.fn(), close: vi.fn() }
    vi.stubGlobal('AudioContext', class { constructor() { return context } })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } })
    try {
      const recording = await startVoiceRecording(vi.fn(), vi.fn())
      processor.onaudioprocess!({ inputBuffer: { getChannelData: () => signal(0) } })
      expect(() => recording.finish()).toThrow(NO_AUDIO_MESSAGE)
      expect(stopTrack).toHaveBeenCalledOnce()
      expect(context.close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})
