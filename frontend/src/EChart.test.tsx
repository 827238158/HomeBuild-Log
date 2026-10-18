import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EChart } from './EChart'

const chart = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
}))
vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: () => ({ ...chart,
    on: (name: string, handler: (event: unknown) => void) => chart.handlers.set(name, handler),
    off: (name: string) => chart.handlers.delete(name),
  }),
}))

const props = {
  title: '问题状态分布', kind: 'donut' as const, option: {}, summary: '问题数量',
  accessibleItems: [{ key: 'pending', label: '待处理' }, { key: 'done', label: '已完成' }],
}

describe('图表就近筛选', () => {
  beforeEach(() => chart.handlers.clear())

  it('标题仅呈现图标操作，清除不展示状态名称或操作说明', () => {
    const onDataClick = vi.fn()
    const view = render(<EChart {...props} selectedKey="pending" onDataClick={onDataClick} />)
    const clear = screen.getByRole('button', { name: '清除问题状态分布筛选' })
    expect(clear.closest('header')).toBeTruthy()
    expect(screen.queryByText('待处理')).toBeNull()
    expect(screen.queryByText(/点击分类筛选|已筛选|已选项|选择分类/)).toBeNull()
    fireEvent.click(clear)
    expect(onDataClick).toHaveBeenLastCalledWith('')
    view.rerender(<EChart {...props} selectedKey="" onDataClick={onDataClick} />)
    expect(screen.queryByRole('button', { name: '清除问题状态分布筛选' })).toBeNull()
  })

  it('图形再次点击选中项取消，点击其他项切换条件', () => {
    const onDataClick = vi.fn()
    const view = render(<EChart {...props} selectedKey="pending" onDataClick={onDataClick} />)
    act(() => chart.handlers.get('click')?.({ data: { key: 'pending' } }))
    expect(onDataClick).toHaveBeenLastCalledWith('')
    act(() => chart.handlers.get('click')?.({ data: { key: 'done' } }))
    expect(onDataClick).toHaveBeenLastCalledWith('done')
    view.rerender(<EChart {...props} selectedKey="" onDataClick={onDataClick} />)
    act(() => chart.handlers.get('click')?.({ data: { key: 'pending' } }))
    expect(onDataClick).toHaveBeenLastCalledWith('pending')
  })

  it('标题分类入口展开后提供类别操作，同项可取消', () => {
    const onDataClick = vi.fn()
    render(<EChart {...props} selectedKey="pending" onDataClick={onDataClick} />)
    const menu = screen.getByRole('button', { name: '问题状态分布分类' })
    expect(menu.closest('header')).toBeTruthy()
    fireEvent.click(menu)
    fireEvent.click(screen.getByText('待处理'))
    expect(onDataClick).toHaveBeenLastCalledWith('')
  })

  it('未传筛选状态的明细图表重复点击仍传原始键', () => {
    const onDataClick = vi.fn()
    render(<EChart {...props} onDataClick={onDataClick} />)
    act(() => chart.handlers.get('click')?.({ data: { key: 'pending' } }))
    act(() => chart.handlers.get('click')?.({ data: { key: 'pending' } }))
    expect(onDataClick.mock.calls).toEqual([['pending'], ['pending']])
    expect(screen.queryByRole('button', { name: /清除.*筛选/ })).toBeNull()
  })

  it('手动日期范围无对应分类时仍提供清除入口', () => {
    const onClear = vi.fn()
    const onDataClick = vi.fn()
    render(<EChart {...props} selectedKey="" hasActiveFilter onClear={onClear} onDataClick={onDataClick} />)
    fireEvent.click(screen.getByRole('button', { name: '清除问题状态分布筛选' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(onDataClick).not.toHaveBeenCalled()
  })

  it('筛选使内容缩短时保留视口高度，返回页首后释放占位', () => {
    const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    const innerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    try {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 400 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
      const view = render(<section className="view-panel"><EChart {...props} selectedKey="" onDataClick={vi.fn()} /></section>)
      const panel = view.container.querySelector<HTMLElement>('.view-panel')!
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ top: -200 } as DOMRect)
      // 图表所在面板从文档 200px 开始，筛选后至少保留至当前视口底部 1200px。
      fireEvent.click(screen.getByRole('button', { name: '问题状态分布分类' }))
      fireEvent.click(screen.getByText('待处理'))
      expect(panel.style.minHeight).toBe('1000px')
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
      fireEvent.scroll(window)
      expect(panel.style.minHeight).toBe('')
    } finally {
      if (scrollY) Object.defineProperty(window, 'scrollY', scrollY)
      if (innerHeight) Object.defineProperty(window, 'innerHeight', innerHeight)
    }
  })
})
