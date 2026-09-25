import { describe, expect, it } from 'vitest'

import { encodeWav } from './voiceAudio'

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
