import { useEffect, useRef } from 'react'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  AriaComponent,
  DatasetComponent,
  GridComponent,
  GraphicComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  AriaComponent,
  DatasetComponent,
  GridComponent,
  GraphicComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
])

export function EChart({
  option,
  summary,
  onDataClick,
  title,
  description,
  kind,
  selectedKey,
}: {
  option: EChartsCoreOption
  summary: string
  onDataClick?: (key: string) => void
  title: string
  description?: string
  kind: 'line' | 'bar' | 'donut'
  selectedKey?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // 每个容器只初始化一个实例，并在组件卸载时释放资源。
    const chart = echarts.init(container, undefined, { renderer: 'svg' })
    chartRef.current = chart
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => chart.resize())
    observer?.observe(container)
    return () => {
      observer?.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption({ aria: { enabled: true, decal: { show: false } }, ...option }, true)
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const clickHandler = (params: { data?: unknown; name?: string }) => {
      if (!onDataClick) return
      const data = params.data as { key?: string } | undefined
      onDataClick(data?.key ?? params.name ?? '')
    }
    chart.on('click', clickHandler)
    return () => {
      chart.off('click', clickHandler)
    }
  }, [onDataClick])

  return <figure className={`chart-card${onDataClick ? ' chart-card--interactive' : ''}${selectedKey ? ' is-filtered' : ''}`} data-chart-kind={kind}>
    <header className="chart-card__header"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{onDataClick && <span>{selectedKey ? '已应用图表筛选' : '点击图形可筛选'}</span>}</header>
    <div ref={containerRef} className="chart-canvas" aria-hidden="true" />
    <figcaption className="sr-only">{summary}</figcaption>
  </figure>
}
