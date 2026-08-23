import { useEffect, useState } from 'react'

import {
  createSource,
  fetchHealth,
  login,
  uploadAttachment,
  type HealthResponse,
  type SourceResponse,
} from './api'
import { listSources } from './domainApi'
import { clearToken, getToken, saveToken } from './token'
import { BACKEND_URL, UI, UPLOAD } from './config'
import './styles.css'
import { DomainWorkspace } from './DomainWorkspace'
import { CoreViews } from './CoreViews'
import { formatBeijingDateTime } from './time'
import { UNAUTHORIZED_EVENT } from './http'

const HIDDEN_RECENT_SOURCES_KEY = 'homebuild-log-hidden-recent-sources'

function readHiddenRecentSources(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HIDDEN_RECENT_SOURCES_KEY) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error' }

interface PendingUpload {
  sourceId: string
  file: File
}

export function App() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [sources, setSources] = useState<SourceResponse[]>([])
  const [saveStatus, setSaveStatus] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [sourceRefreshKey, setSourceRefreshKey] = useState(0)
  const [preferredSourceId, setPreferredSourceId] = useState('')
  const [hiddenRecentSourceIds, setHiddenRecentSourceIds] = useState<string[]>(readHiddenRecentSources)

  const visibleRecentSources = sources
    .slice(0, 3)
    .filter((source) => !hiddenRecentSourceIds.includes(source.id))

  const hideRecentSource = (sourceId: string) => {
    setHiddenRecentSourceIds((current) => {
      const next = current.includes(sourceId) ? current : [...current, sourceId]
      try {
        localStorage.setItem(HIDDEN_RECENT_SOURCES_KEY, JSON.stringify(next))
      } catch {
        // 本地存储不可用时仍允许本次页面内关闭。
      }
      return next
    })
  }

  useEffect(() => {
    const controller = new AbortController()

    const token = getToken()

    if (token) {
      fetchHealth(controller.signal)
        .then((health) => setState({ kind: 'ready', health }))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            clearToken()
            setState({ kind: 'login' })
          }
        })
    } else {
      fetchHealth(controller.signal)
        .then(() => setState({ kind: 'login' }))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setState({ kind: 'error' })
          }
        })
    }

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (state.kind !== 'ready') return
    listSources()
      .then((rows) => setSources(Array.isArray(rows) ? rows : []))
      .catch(() => setSources([]))
  }, [state.kind])

  const handleLogin = async () => {
    setLoginError('')
    try {
      const result = await login(password)
      saveToken(result.access_token)
      setState({ kind: 'loading' })
      try {
        const health = await fetchHealth()
        setState({ kind: 'ready', health })
      } catch {
        setState({ kind: 'error' })
      }
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : '登录失败')
    }
  }

  const handleLogout = () => {
    clearToken()
    setState({ kind: 'login' })
    setPassword('')
    setLoginError('')
    setSourceText('')
    setSources([])
    setAttachment(null)
    setAttachmentError('')
    setPendingUpload(null)
  }

  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, handleLogout)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleLogout)
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && state.kind === 'login') {
      handleLogin()
    }
  }

  const saveSource = async (text: string, file: File | null): Promise<SourceResponse | null> => {
    const entry = await createSource(text.trim())
    setSources((prev) => [entry, ...prev])
    // 仅在后端成功返回真实 ID 后切换来源，失败时保留原选择。
    setPreferredSourceId(entry.id)
    setSourceRefreshKey((value) => value + 1)
    setSourceText('')
    if (file) {
      try {
        await uploadAttachment(entry.id, file)
        setAttachment(null)
        setPendingUpload(null)
        setAttachmentError('')
      } catch (error: unknown) {
        // 来源已经成功保存，附件失败时保留重试上下文，避免重复创建来源。
        setPendingUpload({ sourceId: entry.id, file })
        setAttachmentError(error instanceof Error ? error.message : '附件上传失败')
        throw new Error('attachment-error')
      }
    }
    return entry
  }

  const handleSaveSource = async () => {
    if (!sourceText.trim()) return
    setSaveStatus('saving')
    try {
      await saveSource(sourceText, attachment)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), UI.toastDuration)
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'attachment-error') {
        setSaveStatus('attachment-error')
      } else {
        setSaveStatus('error')
      }
    }
  }

  const handleAttachmentChange = (file: File | null) => {
    setAttachmentError('')
    setPendingUpload(null)
    if (!file) {
      setAttachment(null)
      return
    }
    if (!UPLOAD.allowedTypes.has(file.type)) {
      setAttachment(null)
      setAttachmentError('仅支持 JPG、PNG、WebP、HEIC 和 PDF。')
      return
    }
    if (file.size > UPLOAD.maxSize) {
      setAttachment(null)
      setAttachmentError('附件不能超过 50 MB。')
      return
    }
    setAttachment(file)
  }

  const handleRetryAttachment = async () => {
    if (!pendingUpload) return
    setSaveStatus('saving')
    try {
      await uploadAttachment(pendingUpload.sourceId, pendingUpload.file)
      setPendingUpload(null)
      setAttachment(null)
      setAttachmentError('')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), UI.toastDuration)
    } catch (error: unknown) {
      setAttachmentError(error instanceof Error ? error.message : '附件上传失败')
      setSaveStatus('attachment-error')
    }
  }

  if (state.kind === 'ready') {
    return <main className="app-workspace">
      <CoreViews onLogout={handleLogout}>
        <section className="capture-workspace">
          <header className="capture-workspace__header"><p className="eyebrow">快速录入</p><h2>记录装修现场</h2><p>先保存原始事实，再到下方按需进行智能拆分。</p></header>
          <div className="source-form">
            <textarea className="source-input" placeholder="记录今天发生的事情…" value={sourceText} onChange={(e) => setSourceText(e.target.value)} rows={3} />
            <label className="attachment-field"><span>附件（可选，单个文件）</span><input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.pdf" onChange={(event) => handleAttachmentChange(event.target.files?.[0] ?? null)} /></label>
            {attachment && <p className="attachment-name">已选择：{attachment.name}</p>}
            {attachmentError && <p className="source-error">{attachmentError}</p>}
            <div className="source-actions">
              <button className="source-save" onClick={handleSaveSource} disabled={!sourceText.trim() || saveStatus === 'saving'}>{saveStatus === 'saving' ? '保存中…' : '保存记录'}</button>
              {saveStatus === 'saved' && <span className="source-saved">已保存</span>}
              {saveStatus === 'error' && <span className="source-error">保存失败</span>}
              {saveStatus === 'attachment-error' && pendingUpload && <button className="attachment-retry" type="button" onClick={handleRetryAttachment}>来源已保存，重试附件</button>}
            </div>
          </div>
          {visibleRecentSources.length > 0 && <div className="source-list"><h2 className="source-list-title">最近记录</h2>{visibleRecentSources.map((s) => <div key={s.id} className="source-item"><button className="source-item-close" type="button" aria-label={`关闭最近记录：${s.original_text || '仅附件记录'}`} onClick={() => hideRecentSource(s.id)}>×</button><p className="source-item-text">{s.original_text}</p><time className="source-item-time">{formatBeijingDateTime(s.captured_at)}</time></div>)}</div>}
          <DomainWorkspace refreshKey={sourceRefreshKey} preferredSourceId={preferredSourceId} onSourcesChanged={() => void listSources().then((rows) => setSources(Array.isArray(rows) ? rows : []))} />
        </section>
      </CoreViews>
    </main>
  }

  return (
    <main className="shell shell--auth">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">装修事实，留得清楚</p>
        <h1 id="page-title">HomeBuild Log</h1>
        <p className="summary">本地优先的装修事件与知识管理系统。</p>

        {state.kind === 'loading' && (
          <div className="status-card status-card--loading" role="status">
            正在检查本地服务…
          </div>
        )}

        {state.kind === 'login' && (
          <div className="status-card status-card--loading" role="form">
            <div>
              <strong>本地管理员登录</strong>
              <div className="login-form">
                <input
                  type="password"
                  className="login-input"
                  placeholder="请输入管理员密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
                <button className="login-button" onClick={handleLogin}>
                  登录
                </button>
              </div>
              {loginError && (
                <p className="login-error">{loginError}</p>
              )}
            </div>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="status-card status-card--error" role="alert">
            <strong>暂时无法连接本地服务</strong>
            <p>请确认后端已在 {BACKEND_URL} 启动，然后刷新页面。</p>
          </div>
        )}
      </section>
    </main>
  )
}
