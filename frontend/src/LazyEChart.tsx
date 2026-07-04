import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import type { EChartProps } from './EChart'

const DeferredEChart = lazy(() => import('./EChart').then(({ EChart }) => ({ default: EChart })))

class ChartErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* 图表失败不阻断业务页面。 */ }
  render() {
    return this.state.failed
      ? <p className="chart-fallback" role="alert">图表加载失败，请刷新后重试。</p>
      : this.props.children
  }
}

export function LazyEChart(props: EChartProps) {
  return <ChartErrorBoundary><Suspense fallback={<div className="chart-loading" role="status">正在加载图表…</div>}><DeferredEChart {...props} /></Suspense></ChartErrorBoundary>
}
