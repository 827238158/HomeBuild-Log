import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'


beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('请求尚未完成时显示加载状态', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))

    render(<App />)

    expect(screen.getByRole('status').textContent).toContain('正在检查本地服务')
  })

  it('后端可达但未登录时显示登录页', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'ok',
          database: { status: 'ok' },
          storage: { status: 'ok' },
        }),
      }),
    )

    render(<App />)

    expect(await screen.findByText('本地管理员登录')).toBeTruthy()
    expect(screen.getByPlaceholderText('请输入管理员密码')).toBeTruthy()
  })

  it('已有 token 且后端正常时直接显示健康状态', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')

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

  it('token 过期时显示登录页', async () => {
    sessionStorage.setItem('homebuild-log-token', 'expired-token')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'token expired' }),
      }),
    )

    render(<App />)

    expect(await screen.findByText('本地管理员登录')).toBeTruthy()
  })

  it('健康检查失败时显示错误提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')))

    await act(async () => render(<App />))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('请确认后端已在 127.0.0.1:8000 启动'),
    )
  })

  it('登录成功后显示健康状态', async () => {
    // 第一次 fetch: 健康检查（后端可达）
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1 || callCount === 4) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: 'ok',
              database: { status: 'ok' },
              storage: { status: 'ok' },
            }),
          })
        }
        // callCount === 2 (login POST) or callCount === 3 (health after login)
        if (callCount === 2) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ access_token: 'new-token', token_type: 'bearer' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            database: { status: 'ok' },
            storage: { status: 'ok' },
          }),
        })
      }),
    )

    render(<App />)

    // 等待登录页显示
    const loginButton = await screen.findByText('登录')
    expect(loginButton).toBeTruthy()

    // 输入密码并登录
    const input = screen.getByPlaceholderText('请输入管理员密码') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'correct-password' } })
    })
    await act(async () => {
      fireEvent.click(loginButton)
    })

    // 应显示健康状态
    expect(await screen.findByText('本地服务运行正常')).toBeTruthy()
  })
})
