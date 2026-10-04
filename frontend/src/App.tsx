import { useEffect, useRef, useState } from 'react'

import {
  createSource,
  fetchHealth,
  login,
  uploadAttachment,
  type HealthResponse,
  type SourceResponse,
} from './api'
import { listSources, type SourceEntry } from './domainApi'
import { clearToken, getToken, saveToken } from './token'
import { BACKEND_URL, UI, UPLOAD } from './config'
import './styles.css'
import { DomainWorkspace } from './DomainWorkspace'
import { CoreViews } from './CoreViews'
import { formatBeijingDateTime } from './time'
import { UNAUTHORIZED_EVENT } from './http'
import { VoiceInput } from './VoiceInput'
import { ThinkingLattice } from './MotionPrimitives'
import { useNavigationGuard } from './navigationGuard'

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
  attachmentVersion: number
}

type SaveStatus = '' | 'saving' | 'saved' | 'error' | 'attachment-error'

function attachmentTypeLabel(file: File): string {
  if (file.type === 'application/pdf') return 'PDF'
  const subtype = file.type.split('/')[1]
  return subtype ? subtype.toUpperCase() : '文件'
}

function attachmentSizeLabel(size: number): string {
  if (size < 1024) return `${size} 字节`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function App() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginPending, setLoginPending] = useState(false)
  const loginInFlight = useRef(false)
  const [sourceText, setSourceText] = useState('')
  const [sources, setSources] = useState<SourceEntry[]>([])
  const [sourceListError, setSourceListError] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const textVersion = useRef(0)
  const attachmentVersion = useRef(0)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null)
  const [sourceRefreshKey, setSourceRefreshKey] = useState(0)
  const [preferredSourceId, setPreferredSourceId] = useState('')
  const [sourceRequestKey, setSourceRequestKey] = useState(0)
  const [manageRequestKey, setManageRequestKey] = useState(0)
  const [captureTab, setCaptureTab] = useState<'quick' | 'review'>('quick')
  const [lastSavedSourceId, setLastSavedSourceId] = useState('')
  const [hiddenRecentSourceIds, setHiddenRecentSourceIds] = useState<string[]>(readHiddenRecentSources)
  useNavigationGuard(Boolean(sourceText.trim() || attachment || pendingUpload))

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

  const openReview = (sourceId?: string) => {
    if (sourceId) {
      setPreferredSourceId(sourceId)
      // 相同来源再次点击时也要重新尝试切换，供未保存草稿提示后重试。
      setSourceRequestKey((value) => value + 1)
    }
    setCaptureTab('review')
  }

  const handleCaptureTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'ArrowRight' || event.key === 'End' ? 'review' : 'quick'
    if (next === 'review') openReview()
    else setCaptureTab('quick')
    requestAnimationFrame(() => document.getElementById(`capture-tab-${next}`)?.focus())
  }

  useEffect(() => {
    // 切换工作区时关闭 Portal 下拉，避免它留在被隐藏的标签外。
    window.dispatchEvent(new CustomEvent('homebuild-dropdown-open', { detail: 'capture-tab' }))
  }, [captureTab])

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

  const refreshSources = async (): Promise<SourceEntry[]> => {
    try {
      const rows = await listSources()
      const nextRows = Array.isArray(rows) ? rows : []
      setSources(nextRows)
      setSourceListError('')
      return nextRows
    } catch (error: unknown) {
      setSourceListError(error instanceof Error ? error.message : '来源列表加载失败')
      throw error
    }
  }

  useEffect(() => {
    if (state.kind !== 'ready') return
    void refreshSources().catch(() => undefined)
  }, [state.kind])

  const handleLogin = async () => {
    if (loginInFlight.current || !password) return
    // 同一轮渲染内重复按回车也只发送一次登录请求。
    loginInFlight.current = true
    setLoginPending(true)
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
    } finally {
      loginInFlight.current = false
      setLoginPending(false)
    }
  }

  const handleLogout = () => {
    textVersion.current += 1
    attachmentVersion.current += 1
    clearToken()
    setState({ kind: 'login' })
    setPassword('')
    setLoginError('')
    setSourceText('')
    setSources([])
    setSourceListError('')
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
    const savedTextVersion = textVersion.current
    const savedAttachmentVersion = attachmentVersion.current
    const entry = await createSource(text.trim())
    setSources((prev) => [entry, ...prev])
    // 仅在后端成功返回真实 ID 后切换来源，失败时保留原选择。
    setSourceRefreshKey((value) => value + 1)
    // 用编辑版本区分新草稿；即使改回同样文字，也不能清空用户的新输入。
    if (textVersion.current === savedTextVersion) setSourceText('')
    if (file) {
      try {
        await uploadAttachment(entry.id, file)
        if (attachmentVersion.current === savedAttachmentVersion) {
          setAttachment(null)
          setAttachmentError('')
          if (attachmentInput.current) attachmentInput.current.value = ''
        }
        setPendingUpload(null)
      } catch (error: unknown) {
        // 来源已经成功保存，附件失败时保留重试上下文，避免重复创建来源。
        setPendingUpload({ sourceId: entry.id, file, attachmentVersion: savedAttachmentVersion })
        if (attachmentVersion.current === savedAttachmentVersion) {
          setAttachmentError(error instanceof Error ? error.message : '附件上传失败')
        }
        throw new Error('attachment-error')
      }
    }
    setLastSavedSourceId(entry.id)
    return entry
  }

  const handleSaveSource = async () => {
    if (!sourceText.trim()) return
    setLastSavedSourceId('')
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
    attachmentVersion.current += 1
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

  const handleRemoveAttachment = () => {
    // 手动移除也要递增版本，避免旧上传请求结束后清理新状态。
    attachmentVersion.current += 1
    setAttachment(null)
    setAttachmentError('')
    setPendingUpload(null)
    if (attachmentInput.current) attachmentInput.current.value = ''
  }

  const handleRetryAttachment = async () => {
    if (!pendingUpload) return
    setSaveStatus('saving')
    try {
      await uploadAttachment(pendingUpload.sourceId, pendingUpload.file)
      setLastSavedSourceId(pendingUpload.sourceId)
      setPendingUpload(null)
      // 重试只清理它对应的附件，不覆盖等待期间的新选择或校验错误。
      if (attachmentVersion.current === pendingUpload.attachmentVersion) {
        setAttachment(null)
        setAttachmentError('')
        if (attachmentInput.current) attachmentInput.current.value = ''
      }
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), UI.toastDuration)
    } catch (error: unknown) {
      if (attachmentVersion.current === pendingUpload.attachmentVersion) {
        setAttachmentError(error instanceof Error ? error.message : '附件上传失败')
      }
      setSaveStatus('attachment-error')
    }
  }

  if (state.kind === 'ready') {
    return <main className="app-workspace">
      <CoreViews onLogout={handleLogout} onOpenSource={openReview} onManageSpaces={() => { openReview(); setManageRequestKey((value) => value + 1) }}>
        <section className="capture-workspace">
          <header className="capture-workspace__header"><h2>记录装修现场</h2></header>
          {sourceListError && <p className="source-error" role="alert">来源列表加载失败：{sourceListError}<button type="button" onClick={() => void refreshSources().catch(() => undefined)}>重试</button></p>}
          <div className="capture-tabs" role="tablist" aria-label="录入工作区" data-active={captureTab}>
            <button id="capture-tab-quick" className="capture-tab" type="button" role="tab" aria-selected={captureTab === 'quick'} aria-controls="capture-panel-quick" tabIndex={captureTab === 'quick' ? 0 : -1} onKeyDown={handleCaptureTabKeyDown} onClick={() => setCaptureTab('quick')}>快速记录</button>
            <button id="capture-tab-review" className="capture-tab" type="button" role="tab" aria-selected={captureTab === 'review'} aria-controls="capture-panel-review" tabIndex={captureTab === 'review' ? 0 : -1} onKeyDown={handleCaptureTabKeyDown} onClick={() => openReview()}>待整理</button>
          </div>
          <div id="capture-panel-quick" className="capture-panel capture-quick" role="tabpanel" aria-labelledby="capture-tab-quick" hidden={captureTab !== 'quick'}>
          <div className="source-form">
            <h3 id="quick-source-label">写下今天的情况</h3>
            <VoiceInput active={captureTab === 'quick'} onTranscript={(text) => { textVersion.current += 1; setSourceText((current) => current ? `${current}\n${text}` : text) }}>
              <textarea aria-labelledby="quick-source-label" className="source-input" placeholder="记录今天发生的事情…" value={sourceText} onChange={(e) => { textVersion.current += 1; setSourceText(e.target.value) }} rows={3} />
            </VoiceInput>
            <div className="source-actions">
              <label className={`attachment-field${attachment ? ' is-selected' : ''}`}><span className="sr-only">附件（可选，单个文件）</span><input ref={attachmentInput} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.pdf" onChange={(event) => handleAttachmentChange(event.target.files?.[0] ?? null)} />{!attachment && <span className="attachment-picker"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7.5 10.5 12.6 5.4a3 3 0 0 1 4.2 4.2l-7.2 7.2a5 5 0 0 1-7.1-7.1l7.5-7.5" /></svg>选择图片或 PDF</span>}</label>
              <button className="source-save state-button" data-state={saveStatus || 'idle'} aria-busy={saveStatus === 'saving'} aria-label={saveStatus === 'saving' ? '正在保存记录' : saveStatus === 'saved' ? '记录已保存' : saveStatus === 'error' ? '重试保存记录' : '保存记录'} onClick={handleSaveSource} disabled={!sourceText.trim() || saveStatus === 'saving'}>{saveStatus === 'saving' && <ThinkingLattice compact />}<span className="state-button__label" aria-live="polite">{saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '重试保存' : '保存记录'}</span></button>
            </div>
            {attachment && <div className="attachment-feedback" role="status" aria-label={`已选择附件：${attachment.name}`}>
              <span className="attachment-feedback__icon" data-file-type={attachment.type === 'application/pdf' ? 'pdf' : 'image'} aria-hidden="true">{attachment.type === 'application/pdf' ? 'PDF' : '图'}</span>
              <span className="attachment-feedback__details"><strong>{attachment.name}</strong><small>{attachmentTypeLabel(attachment)} · {attachmentSizeLabel(attachment.size)}</small></span>
              <button className="attachment-feedback__replace" type="button" onClick={() => attachmentInput.current?.click()}>更换附件</button>
              <button className="attachment-feedback__remove" type="button" onClick={handleRemoveAttachment}>移除附件</button>
            </div>}
            {attachmentError && <p className="source-error" role="alert">{attachmentError}</p>}
            {saveStatus === 'error' && <p className="source-error" role="alert">保存失败</p>}
            {saveStatus === 'attachment-error' && pendingUpload && <button className="attachment-retry" type="button" onClick={handleRetryAttachment}>来源已保存，重试附件</button>}
            {lastSavedSourceId && saveStatus !== 'attachment-error' && <div className="capture-next-step"><span>原始记录已保存，整理可以稍后再做。</span><button type="button" onClick={() => openReview(lastSavedSourceId)}>去整理这条记录</button></div>}
          </div>
            {visibleRecentSources.length > 0 && <div className="source-list"><h3 className="source-list-title">最近记录</h3>{visibleRecentSources.map((s) => <div key={s.id} className="source-item recent-source-row"><p className="source-item-text">{s.original_text}</p><time className="source-item-time">{formatBeijingDateTime(s.captured_at)}</time><div className="recent-source-row__actions"><button type="button" onClick={() => openReview(s.id)}>去整理</button><button className="source-item-close" type="button" aria-label={`关闭最近记录：${s.original_text || '仅附件记录'}`} onClick={() => hideRecentSource(s.id)}>×</button></div></div>)}</div>}
          </div>
          <div id="capture-panel-review" className="capture-panel capture-review" role="tabpanel" aria-labelledby="capture-tab-review" hidden={captureTab !== 'review'}>
            <DomainWorkspace sources={sources} refreshSources={refreshSources} refreshKey={sourceRefreshKey} preferredSourceId={preferredSourceId} sourceRequestKey={sourceRequestKey} manageRequestKey={manageRequestKey} />
          </div>
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
                <label className="sr-only" htmlFor="admin-password">管理员密码</label>
                <input
                  id="admin-password"
                  autoComplete="current-password"
                  aria-describedby={loginError ? 'login-error' : undefined}
                  aria-invalid={Boolean(loginError)}
                  type="password"
                  className="login-input"
                  placeholder="请输入管理员密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
                <button className="login-button" disabled={loginPending || !password} aria-busy={loginPending} onClick={handleLogin}>
                  {loginPending ? '正在登录…' : '登录'}
                </button>
              </div>
              {loginError && (
                <p id="login-error" className="login-error" role="alert">{loginError}</p>
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
