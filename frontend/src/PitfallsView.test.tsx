import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './domainApi'
import { PitfallsView } from './PitfallsView'

vi.mock('./domainApi', () => ({
  listPitfalls: vi.fn(),
  createPitfall: vi.fn(),
  updatePitfall: vi.fn(),
  deletePitfall: vi.fn(),
  createPitfallResolution: vi.fn(),
  updatePitfallResolution: vi.fn(),
  deletePitfallResolution: vi.fn(),
  analyzePitfalls: vi.fn(),
}))

const pitfall = {
  id: 'pitfall-1',
  occurred_date: '2026-08-10',
  description: '墙面返碱',
  status: 'unresolved' as const,
  resolutions: [],
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-10T00:00:00Z',
}

describe('PitfallsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    vi.mocked(api.listPitfalls).mockResolvedValue({
      items: [pitfall],
      summary: { total: 1, unresolved: 1, resolved: 0 },
    })
    vi.mocked(api.createPitfallResolution).mockResolvedValue({
      id: 'resolution-1',
      pitfall_id: pitfall.id,
      resolved_date: '2026-08-12',
      content: '排查水汽来源',
      created_at: '2026-08-12T00:00:00Z',
      updated_at: '2026-08-12T00:00:00Z',
    })
  })

  it('展示手帐主题并移除冗余引导文字', async () => {
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')

    expect(screen.getByRole('heading', { name: '如果在装修之前就知道这些' })).toBeTruthy()
    expect(screen.queryByText(/随手记下问题/)).toBeNull()
    expect(screen.queryByText('只需日期和经过，稍后再补处理记录。')).toBeNull()
    expect(screen.queryByText('快速记一笔')).toBeNull()
    expect(screen.queryByText('发生')).toBeNull()
  })

  it('通过一体式编辑器新建踩坑记录', async () => {
    vi.mocked(api.createPitfall).mockResolvedValue(pitfall)
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')

    fireEvent.change(screen.getByLabelText('发生日期'), { target: { value: '2026-08-18' } })
    fireEvent.change(screen.getByLabelText('踩坑经过'), { target: { value: '门洞尺寸预留不足' } })
    fireEvent.click(screen.getByRole('button', { name: '记下这次踩坑' }))

    await waitFor(() => expect(api.createPitfall).toHaveBeenCalledWith({
      occurred_date: '2026-08-18',
      description: '门洞尺寸预留不足',
    }))
  })

  it('将必填提示与提交按钮放在同一操作栏', async () => {
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')

    fireEvent.click(screen.getByRole('button', { name: '记下这次踩坑' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('请填写踩坑经过。')
    expect(alert.parentElement?.classList.contains('pitfall-form__actions')).toBe(true)
    expect(api.createPitfall).not.toHaveBeenCalled()
  })

  it('展示摘要并按未处理状态筛选', async () => {
    render(<PitfallsView />)
    expect(await screen.findByText('墙面返碱')).toBeTruthy()
    expect(screen.getAllByText('未处理').length).toBeGreaterThan(0)

    const tabs = screen.getByRole('tablist', { name: '筛选踩坑记录' })
    const allTab = screen.getByRole('tab', { name: '全部' })
    const unresolvedTab = screen.getByRole('tab', { name: '未处理' })
    expect(allTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(allTab, { key: 'ArrowRight' })
    expect(unresolvedTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(unresolvedTab)
    expect(tabs.style.getPropertyValue('--tab-indicator-width')).not.toBe('')
    await waitFor(() => expect(api.listPitfalls).toHaveBeenLastCalledWith('unresolved'))
    expect(screen.getByText('墙面返碱').closest('.timeline-motion-item')?.getAttribute('data-motion-index')).toBe('0')
  })

  it('从同一踩坑内追加处理记录', async () => {
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getByRole('button', { name: '+ 追加处理' }))
    fireEvent.change(screen.getByPlaceholderText('这次做了什么、结果怎样？'), {
      target: { value: '排查水汽来源' },
    })
    fireEvent.click(screen.getByRole('button', { name: '追加处理记录' }))
    await waitFor(() => expect(api.createPitfallResolution).toHaveBeenCalledWith(
      pitfall.id,
      expect.objectContaining({ content: '排查水汽来源' }),
    ))
    await waitFor(() => expect(api.listPitfalls).toHaveBeenCalledTimes(2))
  })

  it('展示 AI 分析失败并允许重试', async () => {
    vi.mocked(api.analyzePitfalls).mockRejectedValue(new Error('AI 尚未启用或未配置可用密钥。'))
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getByRole('button', { name: '一键分析全部' }))
    expect(await screen.findByText('分析未完成')).toBeTruthy()
    expect(screen.getByText('AI 尚未启用或未配置可用密钥。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(api.analyzePitfalls).toHaveBeenCalledTimes(2))
  })
  it('新建草稿跨页面卸载保留日期，保存成功后清除', async () => {
    vi.mocked(api.createPitfall).mockResolvedValue(pitfall)
    const first = render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.change(screen.getByLabelText('发生日期'), { target: { value: '2026-08-18' } })
    fireEvent.change(screen.getByLabelText('踩坑经过'), { target: { value: '未保存现场内容' } })
    first.unmount()
    render(<PitfallsView />)
    expect((screen.getByLabelText('踩坑经过') as HTMLTextAreaElement).value).toBe('未保存现场内容')
    expect((screen.getByLabelText('发生日期') as HTMLInputElement).value).toBe('2026-08-18')
    fireEvent.click(screen.getByRole('button', { name: '记下这次踩坑' }))
    await waitFor(() => expect(sessionStorage.getItem('homebuild:pitfall:new')).toBeNull())
  })

  it('追加处理草稿跨页面保留，保存失败保留，明确放弃后清除', async () => {
    vi.mocked(api.createPitfallResolution).mockRejectedValue(new Error('保存失败'))
    const first = render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getByRole('button', { name: '+ 追加处理' }))
    fireEvent.change(screen.getByLabelText('处理日期'), { target: { value: '2026-08-19' } })
    fireEvent.change(screen.getByLabelText('处理内容'), { target: { value: '尚未提交处理' } })
    first.unmount()
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getByRole('button', { name: '+ 追加处理' }))
    expect((screen.getByLabelText('处理内容') as HTMLTextAreaElement).value).toBe('尚未提交处理')
    expect((screen.getByLabelText('处理日期') as HTMLInputElement).value).toBe('2026-08-19')
    fireEvent.click(screen.getByRole('button', { name: '追加处理记录' }))
    await screen.findByText('保存失败')
    expect((screen.getByLabelText('处理内容') as HTMLTextAreaElement).value).toBe('尚未提交处理')
    fireEvent.click(screen.getByRole('button', { name: '放弃本次处理' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 追加处理' }))
    expect((screen.getByLabelText('处理内容') as HTMLTextAreaElement).value).toBe('')
  })

  it('踩坑修改与处理修改草稿按记录隔离并保留', async () => {
    vi.mocked(api.listPitfalls).mockResolvedValue({ items: [{ ...pitfall, resolutions: [{ id: 'resolution-1', pitfall_id: pitfall.id, resolved_date: '2026-08-12', content: '原处理内容', created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z' }] }], summary: { total: 1, unresolved: 0, resolved: 1 } })
    const first = render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0])
    fireEvent.change(screen.getAllByLabelText('踩坑经过')[1], { target: { value: '修改草稿' } })
    first.unmount()
    const second = render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0])
    expect((screen.getAllByLabelText('踩坑经过')[1] as HTMLTextAreaElement).value).toBe('修改草稿')
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[1])
    fireEvent.change(screen.getByLabelText('处理内容'), { target: { value: '处理修改草稿' } })
    second.unmount()
    render(<PitfallsView />)
    await screen.findByText('墙面返碱')
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[1])
    expect((screen.getByLabelText('处理内容') as HTMLTextAreaElement).value).toBe('处理修改草稿')
    expect((screen.getByLabelText('踩坑经过') as HTMLTextAreaElement).value).toBe('')
  })

})
