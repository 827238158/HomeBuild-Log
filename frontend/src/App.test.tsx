import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'


afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('请求尚未完成时显示加载状态', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))

    render(<App />)

    expect(screen.getByRole('status').textContent).toContain('正在检查本地服务')
  })

  it('健康检查成功时显示数据库和存储状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          database: { status: 'ok' },
          storage: { status: 'ok' },
        }),
      }),
    )

    render(<App />)

    expect(await screen.findByText('本地服务运行正常')).toBeTruthy()
    expect(screen.getByText(/数据库：ok/)).toBeTruthy()
  })

  it('健康检查失败时显示可行动提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')))

    await act(async () => render(<App />))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('请确认后端已在 127.0.0.1:8000 启动'),
    )
  })
})
