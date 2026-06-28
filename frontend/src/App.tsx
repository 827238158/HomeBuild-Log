import { useEffect, useState } from 'react'

import { fetchHealth, type HealthResponse } from './api'
import './styles.css'

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'error' }

export function App() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    fetchHealth(controller.signal)
      .then((health) => setState({ kind: 'ready', health }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ kind: 'error' })
        }
      })

    return () => controller.abort()
  }, [])

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

        {state.kind === 'ready' && (
          <div className="status-card status-card--ready" role="status">
            <span className="status-dot" aria-hidden="true" />
            <div>
              <strong>本地服务运行正常</strong>
              <p>
                数据库：{state.health.database.status} · 存储：{state.health.storage.status}
              </p>
            </div>
          </div>
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

