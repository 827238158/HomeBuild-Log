import { useEffect, useState } from 'react'

import {
  createSource,
  fetchHealth,
  login,
  uploadAttachment,
  type HealthResponse,
  type SourceResponse,
} from './api'
import { clearToken, getToken, saveToken } from './token'
import './styles.css'
import { DomainWorkspace } from './DomainWorkspace'
import { CoreViews } from './CoreViews'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error' }

const allowedAttachmentTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
])
const maxAttachmentBytes = 50 * 1024 * 1024

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && state.kind === 'login') {
      handleLogin()
    }
  }

  const handleSaveSource = async () => {
    if (!sourceText.trim()) return
    setSaveStatus('saving')
    try {
      const entry = await createSource(sourceText.trim())
      setSources((prev) => [entry, ...prev])
      setSourceText('')
      if (attachment) {
        try {
          await uploadAttachment(entry.id, attachment)
          setAttachment(null)
          setPendingUpload(null)
          setAttachmentError('')
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus(''), 2000)
        } catch (error: unknown) {
          // 来源已经成功保存，附件失败时保留重试上下文，避免重复创建来源。
          setPendingUpload({ sourceId: entry.id, file: attachment })
          setAttachmentError(error instanceof Error ? error.message : '附件上传失败')
          setSaveStatus('attachment-error')
        }
      } else {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(''), 2000)
      }
    } catch {
      setSaveStatus('error')
    }
  }

  const handleAttachmentChange = (file: File | null) => {
    setAttachmentError('')
    setPendingUpload(null)
    if (!file) {
      setAttachment(null)
      return
    }
    if (!allowedAttachmentTypes.has(file.type)) {
      setAttachment(null)
      setAttachmentError('仅支持 JPG、PNG、WebP、HEIC 和 PDF。')
      return
    }
    if (file.size > maxAttachmentBytes) {
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
      setTimeout(() => setSaveStatus(''), 2000)
    } catch (error: unknown) {
      setAttachmentError(error instanceof Error ? error.message : '附件上传失败')
      setSaveStatus('attachment-error')
    }
  }

  return (
    <main className="shell">
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

        {state.kind === 'ready' && (
          <>
            <div className="status-card status-card--ready" role="status">
              <span className="status-dot" aria-hidden="true" />
              <div>
                <strong>本地服务运行正常</strong>
                <p>
                  数据库：{state.health.database.status} · 存储：
                  {state.health.storage.status}
                </p>
              </div>
              <button className="logout-button" onClick={handleLogout} type="button">
                退出
              </button>
            </div>

            <CoreViews><div className="source-form">
              <textarea
                className="source-input"
                placeholder="记录今天发生的事情…"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={3}
              />
              <label className="attachment-field">
                <span>附件（可选，单个文件）</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                  onChange={(event) => handleAttachmentChange(event.target.files?.[0] ?? null)}
                />
              </label>
              {attachment && <p className="attachment-name">已选择：{attachment.name}</p>}
              {attachmentError && <p className="source-error">{attachmentError}</p>}
              <div className="source-actions">
                <button
                  className="source-save"
                  onClick={handleSaveSource}
                  disabled={!sourceText.trim() || saveStatus === 'saving'}
                >
                  {saveStatus === 'saving' ? '保存中…' : '保存记录'}
                </button>
                {saveStatus === 'saved' && (
                  <span className="source-saved">已保存</span>
                )}
                {saveStatus === 'error' && (
                  <span className="source-error">保存失败</span>
                )}
                {saveStatus === 'attachment-error' && pendingUpload && (
                  <button className="attachment-retry" type="button" onClick={handleRetryAttachment}>
                    来源已保存，重试附件
                  </button>
                )}
              </div>
            </div>

            {sources.length > 0 && (
              <div className="source-list">
                <h2 className="source-list-title">最近记录</h2>
                {sources.map((s) => (
                  <div key={s.id} className="source-item">
                    <p className="source-item-text">{s.original_text}</p>
                    <time className="source-item-time">
                      {new Date(s.captured_at).toLocaleString('zh-CN')}
                    </time>
                  </div>
                ))}
              </div>
            )}
            <DomainWorkspace refreshKey={sources.length} /></CoreViews>
          </>
        )}

        {state.kind === 'error' && (
          <div className="status-card status-card--error" role="alert">
            <strong>暂时无法连接本地服务</strong>
            <p>请确认后端已在 127.0.0.1:8000 启动，然后刷新页面。</p>
          </div>
        )}
      </section>
    </main>
  )
}
