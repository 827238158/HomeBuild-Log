const TARGET_SAMPLE_RATE = 16_000
export const MAX_RECORDING_MS = 180_000

export interface VoiceRecording {
  finish(): File
  cancel(): void
}

export async function startVoiceRecording(
  onLevel: (level: number) => void,
  onLimit: () => void,
): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  let context: AudioContext | undefined
  try {
    context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    let sampleCount = 0
    let closed = false
    const maxSamples = Math.floor(context.sampleRate * MAX_RECORDING_MS / 1000)
    processor.onaudioprocess = (event) => {
      if (closed) return
      const input = event.inputBuffer.getChannelData(0)
      const remaining = maxSamples - sampleCount
      if (remaining <= 0) { onLimit(); return }
      const copy = new Float32Array(input.subarray(0, remaining))
      chunks.push(copy)
      sampleCount += copy.length
      let sum = 0
      for (let i = 0; i < copy.length; i++) sum += copy[i] * copy[i]
      onLevel(Math.min(1, Math.sqrt(sum / copy.length) * 5))
      if (sampleCount >= maxSamples) onLimit()
    }
    source.connect(processor)
    // ScriptProcessor 需要连接输出才会持续触发；不写入输出缓冲，因此不会回放麦克风。
    processor.connect(context.destination)
    await context.resume()

    const close = () => {
      if (closed) return false
      closed = true
      processor.onaudioprocess = null
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void context?.close()
      onLevel(0)
      return true
    }
    return {
      cancel: () => { close() },
      finish: () => {
        if (!close()) throw new Error('录音已经结束')
        const wav = encodeWav(chunks, sampleCount, context!.sampleRate)
        return new File([wav], 'recording.wav', { type: 'audio/wav' })
      },
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    if (context) void context.close()
    throw error
  }
}

export function encodeWav(chunks: Float32Array[], sampleCount: number, inputSampleRate: number): ArrayBuffer {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0 || sampleCount <= 0) {
    throw new Error('录音数据不可用，请重试')
  }
  const samples = new Float32Array(sampleCount)
  let offset = 0
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length }
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outputCount = Math.floor(sampleCount / ratio)
  const buffer = new ArrayBuffer(44 + outputCount * 2)
  const view = new DataView(buffer)
  const writeText = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  writeText(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true)
  writeText(8, 'WAVE'); writeText(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, TARGET_SAMPLE_RATE, true); view.setUint32(28, TARGET_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeText(36, 'data'); view.setUint32(40, outputCount * 2, true)
  // 统一为 16 kHz 单声道 PCM，减小三分钟录音的上传大小。
  for (let i = 0; i < outputCount; i++) {
    const position = i * ratio
    const left = Math.floor(position)
    const fraction = position - left
    const value = Math.max(-1, Math.min(1, samples[left] * (1 - fraction) + samples[Math.min(left + 1, sampleCount - 1)] * fraction))
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return buffer
}
