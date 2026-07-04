import { useEffect, useRef, type CSSProperties } from 'react'
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
import type { EChartsCoreOption, ECElementEvent } from 'echarts/core'
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

export interface EChartProps {
  option: EChartsCoreOption
  summary: string
  onDataClick?: (key: string) => void
  title: string
  description?: string
  kind: 'line' | 'bar' | 'donut'
  selectedKey?: string
  onDataHover?: (event: ChartDataEvent) => void
  onDataLeave?: () => void
  scrollableContentHeight?: number
  scrollableMaxHeight?: number
}

export interface ChartDataEvent {
  key: string
  clientX: number
  clientY: number
  anchorRect: ChartAnchorRect
}

export interface ChartAnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export function EChart({
  option,
  summary,
  onDataClick,
  title,
  description,
  kind,
  selectedKey,
  onDataHover,
  onDataLeave,
  scrollableContentHeight,
  scrollableMaxHeight,
}: EChartProps) {
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
    const dataEvent = (params: ECElementEvent): ChartDataEvent => {
      const data = params.data as { key?: string } | undefined
      const nativeEvent = params.event?.event
      const rect = containerRef.current?.getBoundingClientRect()
      const clientX = nativeEvent && 'clientX' in nativeEvent ? nativeEvent.clientX : undefined
      const clientY = nativeEvent && 'clientY' in nativeEvent ? nativeEvent.clientY : undefined
      const resolvedX = clientX ?? (rect ? rect.left + rect.width / 2 : 0)
      const resolvedY = clientY ?? (rect ? rect.top + rect.height / 2 : 0)
      return {
        key: data?.key ?? params.name ?? '',
        clientX: resolvedX,
        clientY: resolvedY,
        // SVG 扇区/柱子的包围盒可能很大，使用指针位置作为稳定的虚拟锚点。
        anchorRect: {
          left: resolvedX, top: resolvedY, right: resolvedX + 1, bottom: resolvedY + 1, width: 1, height: 1,
        },
      }
    }
    const clickHandler = (params: ECElementEvent) => {
      if (!onDataClick) return
      onDataClick(dataEvent(params).key)
    }
    const hoverHandler = (params: ECElementEvent) => {
      if (onDataHover) onDataHover(dataEvent(params))
    }
    const leaveHandler = () => onDataLeave?.()
    chart.on('click', clickHandler)
    chart.on('mouseover', hoverHandler)
    chart.on('mouseout', leaveHandler)
    chart.on('globalout', leaveHandler)
    return () => {
      chart.off('click', clickHandler)
      chart.off('mouseover', hoverHandler)
      chart.off('mouseout', leaveHandler)
      chart.off('globalout', leaveHandler)
    }
  }, [onDataClick, onDataHover, onDataLeave])

  const scrollable = scrollableContentHeight !== undefined && scrollableMaxHeight !== undefined
  const viewportStyle = scrollable ? {
    '--chart-content-height': `${scrollableContentHeight}px`,
    '--chart-max-height': `${scrollableMaxHeight}px`,
  } as CSSProperties : undefined

  return <figure className={`chart-card${onDataClick ? ' chart-card--interactive' : ''}${selectedKey ? ' is-filtered' : ''}`} data-chart-kind={kind}>
    <header className="chart-card__header"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{onDataClick && <span>{selectedKey ? '已应用图表筛选' : '点击图形可筛选'}</span>}</header>
    <div className={scrollable ? 'chart-scroll-viewport' : undefined} style={viewportStyle}>
      <div ref={containerRef} className={`chart-canvas${scrollable ? ' chart-canvas--scroll-content' : ''}`} aria-hidden="true" />
    </div>
    <figcaption className="sr-only">{summary}</figcaption>
  </figure>
}
