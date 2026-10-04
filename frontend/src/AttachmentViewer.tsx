import { useEffect, useRef, useState } from 'react'
import type { AttachmentEntry } from './domainApi'
import { API_BASE } from './config'
import { authHeaders, HttpError, UNAUTHORIZED_EVENT } from './http'
import { clearToken } from './token'

export function AttachmentViewer({ attachment }: { attachment: AttachmentEntry }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const objectUrl = useRef('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }
  }, [])
  const load = async () => {
    if (busy) return
    setBusy(true); setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      // 令牌只放请求头；附件通过短期 blob URL 展示，不出现在地址或日志中。
      const response = await fetch(`${API_BASE}/attachments/${encodeURIComponent(attachment.id)}/content`, { headers: authHeaders(), signal: controller.signal })
      if (!mounted.current || controller.signal.aborted) return
      if (!response.ok) {
        if (response.status === 401) { clearToken(); window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)) }
        const body = await response.json().catch(() => ({})) as { detail?: string }
        throw new HttpError(body.detail || '附件读取失败，请重试。', response.status, `HTTP_${response.status}`)
      }
      const blob = await response.blob()
      if (!mounted.current) return
      const next = URL.createObjectURL(blob)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = next; setUrl(next)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '附件读取失败，请重试。') }
    finally { if (mounted.current) setBusy(false) }
  }
  return <div className="attachment-viewer">
    <p>{attachment.original_filename} · {Math.ceil(attachment.size_bytes / 1024)} 千字节</p>
    {!url && <button type="button" disabled={busy} onClick={() => void load()}>{busy ? '读取附件中…' : error ? '重试查看附件' : '查看附件'}</button>}
    {error && <p role="alert">{error}</p>}
    {url && <><a href={url} target="_blank" rel="noopener noreferrer">在新窗口打开附件</a> <a href={url} download={attachment.original_filename}>下载原件</a>
      {attachment.media_type.startsWith('image/') && attachment.media_type !== 'image/heic' && <img src={url} alt={attachment.original_filename} />}
      {attachment.media_type === 'image/heic' && <p className="muted">浏览器可能无法显示 HEIC，请下载原件查看。</p>}
      <button type="button" onClick={() => { URL.revokeObjectURL(url); objectUrl.current = ''; setUrl('') }}>收起附件</button>
    </>}
  </div>
}
