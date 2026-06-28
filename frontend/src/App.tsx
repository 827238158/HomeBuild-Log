import { useEffect, useState } from 'react'

import { createSource, fetchHealth, login, type HealthResponse, type SourceResponse } from './api'
import { clearToken, getToken, saveToken } from './token'
import './styles.css'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error' }

export function App() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [sources, setSources] = useState<SourceResponse[]>([])
  const [saveStatus, setSaveStatus] = useState('')

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
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2000)
    } catch {
      setSaveStatus('error')
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

            <div className="source-form">
              <textarea
                className="source-input"
                placeholder="记录今天发生的事情…"
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                rows={3}
              />
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
