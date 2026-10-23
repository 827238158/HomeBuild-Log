import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecentReview } from './RecentReview'
import { requestJson } from './http'
import { listTopics } from './topicsApi'
vi.mock('./http', () => ({ requestJson: vi.fn() }))
vi.mock('./topicsApi', () => ({ listTopics: vi.fn() }))
const result = { generated_at: '2026-10-23T03:00:00Z', fingerprint: 'a', sections: [{ kind: 'progress', items: [{ text: '已完成测量', references: [{ id: 'r', title: '测量记录', record_type: 'event' }] }] }] }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listTopics).mockResolvedValue({ items: [], summary: { total: 0, active: 0, archived: 0 } }) })
afterEach(cleanup)
it('手动生成、引用跳转及记录变化提示', async () => {
  vi.mocked(requestJson).mockResolvedValueOnce(result).mockResolvedValue({ fingerprint: 'b' })
  const onOpen = vi.fn()
  render(<RecentReview revision={0} onOpen={onOpen} />)
  expect(requestJson).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '生成回顾' }))
  fireEvent.click(await screen.findByRole('button', { name: '测量记录' }))
  expect(onOpen).toHaveBeenCalledWith('r', 'event')
  expect(await screen.findByText(/记录已变化/)).toBeTruthy()
})
it('范围变化后旧请求不能回填', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(requestJson).mockImplementation(() => new Promise(done => { resolve = done }))
  render(<RecentReview revision={0} onOpen={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '生成回顾' }))
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } })
  await act(async () => resolve(result))
  expect(screen.queryByText('已完成测量')).toBeNull()
})
it('失败后允许重试', async () => {
  vi.mocked(requestJson).mockRejectedValueOnce(new Error('服务暂不可用')).mockResolvedValueOnce(result).mockResolvedValue({ fingerprint: 'a' })
  render(<RecentReview revision={0} onOpen={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '生成回顾' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('服务暂不可用'))
  fireEvent.click(screen.getByRole('button', { name: '重试生成' }))
  expect(await screen.findByText('已完成测量')).toBeTruthy()
})
