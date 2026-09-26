import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const domainWorkspaceProps = vi.hoisted(() => vi.fn())
vi.mock('./DomainWorkspace', () => ({
  DomainWorkspace: (props: { refreshKey: number; preferredSourceId?: string; sourceRequestKey?: number }) => {
    domainWorkspaceProps(props)
    return null
  },
}))
vi.mock('./CoreViews', () => ({ CoreViews: ({ children }: { children: ReactNode }) => children }))

import { App } from './App'


beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  domainWorkspaceProps.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('来源列表加载失败后可重试，整理页共享刷新结果', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    let sourceRequests = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/sources')) {
        sourceRequests += 1
        return sourceRequests === 1
          ? Promise.reject(new Error('网络暂不可用'))
          : Promise.resolve({ ok: true, json: async () => [{ id: 'source-1', original_text: '现场新记录', captured_at: '2026-09-26T00:00:00Z' }] })
      }
      return Promise.resolve({ ok: true, json: async () => ({ status: 'ok' }) })
    }))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('网络暂不可用'))
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('现场新记录')).toBeTruthy()
    const lastProps = domainWorkspaceProps.mock.calls.at(-1)?.[0]
    expect(lastProps.sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'source-1' })]))
  })

  it('默认打开快速记录，切换标签保留未提交文字', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => Promise.resolve({
      ok: true,
      json: async () => String(input).endsWith('/sources') ? [] : { status: 'ok' },
    })))
    render(<App />)

    const input = await screen.findByPlaceholderText('记录今天发生的事情…') as HTMLTextAreaElement
    const quickTab = screen.getByRole('tab', { name: '快速记录' })
    const reviewTab = screen.getByRole('tab', { name: '待整理' })
    expect(quickTab.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('capture-panel-review')?.hidden).toBe(true)
    fireEvent.change(input, { target: { value: '尚未保存的现场情况' } })
    fireEvent.click(reviewTab)
    expect(reviewTab.getAttribute('aria-selected')).toBe('true')
    expect(document.getElementById('capture-panel-quick')?.hidden).toBe(true)
    fireEvent.click(quickTab)
    expect(input.value).toBe('尚未保存的现场情况')
    expect(document.getElementById('capture-panel-quick')?.hidden).toBe(false)
  })

  it.each(['新草稿', '原草稿'])('保存返回时保留等待期间编辑的文字：%s', async (nextText) => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    let complete!: (value: unknown) => void
    const pending = new Promise((resolve) => { complete = resolve })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return pending
      return Promise.resolve({ ok: true, json: async () => String(input).endsWith('/sources') ? [] : { status: 'ok' } })
    }))
    render(<App />)
    const input = await screen.findByPlaceholderText('记录今天发生的事情…')
    fireEvent.change(input, { target: { value: '原草稿' } })
    fireEvent.click(screen.getByText('保存记录'))
    fireEvent.change(input, { target: { value: '中间编辑' } })
    fireEvent.change(input, { target: { value: nextText } })
    await act(async () => complete({ ok: true, json: async () => ({ id: 'saved', original_text: '原草稿', captured_at: '2026-09-21T00:00:00Z' }) }))
    expect((input as HTMLTextAreaElement).value).toBe(nextText)
    expect(await screen.findByText('已保存')).toBeTruthy()
  })

  it('保存失败时保留输入并停留在快速记录', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new Error('网络暂不可用'))
      return Promise.resolve({ ok: true, json: async () => String(input).endsWith('/sources') ? [] : { status: 'ok' } })
    }))
    render(<App />)
    const input = await screen.findByPlaceholderText('记录今天发生的事情…') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '待重试的现场记录' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }))

    expect(await screen.findByText('保存失败')).toBeTruthy()
    expect(input.value).toBe('待重试的现场记录')
    expect(screen.getByRole('tab', { name: '快速记录' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('button', { name: '去整理这条记录' })).toBeNull()
  })

  it.each([false, true])('附件请求完成时保留新选择（重试：%s）', async (retry) => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    let complete!: (value: unknown) => void
    const pending = new Promise((resolve) => { complete = resolve })
    let attempts = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/attachments')) {
        attempts += 1
        if (retry && attempts === 1) return Promise.resolve({ ok: false, json: async () => ({ detail: '上传失败' }) })
        return pending
      }
      return Promise.resolve({ ok: true, json: async () => init?.method === 'POST'
        ? { id: 'saved', original_text: '旧来源', captured_at: '2026-09-21T00:00:00Z' }
        : String(input).endsWith('/sources') ? [] : { status: 'ok' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    const input = await screen.findByPlaceholderText('记录今天发生的事情…')
    const fileInput = screen.getByLabelText(/附件/)
    fireEvent.change(input, { target: { value: '旧来源' } })
    fireEvent.change(fileInput, { target: { files: [new File(['old'], 'old.png', { type: 'image/png' })] } })
    await act(async () => fireEvent.click(screen.getByText('保存记录')))
    if (retry) fireEvent.click(await screen.findByText('来源已保存，重试附件'))
    fireEvent.change(input, { target: { value: '下一条来源' } })
    fireEvent.change(fileInput, { target: { files: [new File(['new'], 'new.png', { type: 'image/png' })] } })
    await act(async () => complete({ ok: true, json: async () => ({ id: 'attachment' }) }))
    expect(await screen.findByText('已保存')).toBeTruthy()
    expect(screen.getByText('已选择：new.png')).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe('下一条来源')
    const uploads = fetchMock.mock.calls.filter(([url]) => String(url).includes('/attachments'))
    expect(uploads).toHaveLength(retry ? 2 : 1)
    for (const [, init] of uploads) expect(((init?.body as FormData).get('file') as File).name).toBe('old.png')
  })

  it('最近记录最多显示三条，关闭后持久隐藏且不补位', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    const rows = ['第一条', '第二条', '第三条', '第四条'].map((original_text, index) => ({
      id: `source-${index + 1}`,
      input_type: 'text',
      original_text,
      captured_at: `2026-07-01T0${4 - index}:00:00+08:00`,
      reported_time_text: null,
    }))
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok', database: { status: 'ok' }, storage: { status: 'ok' } }),
      })
      if (url.endsWith('/sources')) return Promise.resolve({ ok: true, json: async () => rows })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const firstRender = render(<App />)
    await screen.findByText('第一条')
    expect(screen.getByText('第二条')).toBeTruthy()
    expect(screen.getByText('第三条')).toBeTruthy()
    expect(screen.queryByText('第四条')).toBeNull()

    fireEvent.click(within(screen.getByText('第一条').closest('.recent-source-row')!).getByRole('button', { name: '去整理' }))
    expect(screen.getByRole('tab', { name: '待整理' }).getAttribute('aria-selected')).toBe('true')
    expect(domainWorkspaceProps.mock.calls.at(-1)?.[0]).toMatchObject({ preferredSourceId: 'source-1', sourceRequestKey: 1 })
    fireEvent.click(screen.getByRole('tab', { name: '快速记录' }))

    fireEvent.click(screen.getByRole('button', { name: '关闭最近记录：第二条' }))
    expect(screen.queryByText('第二条')).toBeNull()
    expect(screen.queryByText('第四条')).toBeNull()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)

    firstRender.unmount()
    render(<App />)
    await screen.findByText('第一条')
    expect(screen.queryByText('第二条')).toBeNull()
    expect(screen.getByText('第三条')).toBeTruthy()
    expect(screen.queryByText('第四条')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭最近记录：第一条' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭最近记录：第三条' }))
    expect(screen.queryByText('最近记录')).toBeNull()
  })

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

    expect(await screen.findByText('记录装修现场')).toBeTruthy()
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

    expect((await screen.findByRole('alert')).textContent).toContain('127.0.0.1:8000')
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
    expect(await screen.findByText('记录装修现场')).toBeTruthy()
  })

  it('保存文字来源后上传所选附件', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            database: { status: 'ok' },
            storage: { status: 'ok' },
          }),
        })
      }
      if (url.endsWith('/sources')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'source-1',
            input_type: 'text',
            original_text: '现场记录',
            captured_at: '2026-06-28T10:00:00+08:00',
            reported_time_text: null,
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'attachment-1',
          source_id: 'source-1',
          original_filename: 'photo.png',
          media_type: 'image/png',
          size_bytes: 3,
          sha256_hex: 'abc',
          created_at: '2026-06-28T10:00:00+08:00',
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('记录装修现场')
    expect(screen.queryByText('保存并分析')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('记录今天发生的事情…'), {
      target: { value: '现场记录' },
    })
    fireEvent.change(screen.getByLabelText(/附件/), {
      target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByText('保存记录'))

    expect(await screen.findByText('已保存')).toBeTruthy()
    // 保存只产生原始来源；用户明确进入待整理时才定向选中它。
    expect(screen.getByRole('tab', { name: '快速记录' }).getAttribute('aria-selected')).toBe('true')
    expect(domainWorkspaceProps.mock.calls.at(-1)?.[0]).toMatchObject({ preferredSourceId: '', sourceRequestKey: 0 })
    fireEvent.click(screen.getByRole('button', { name: '去整理这条记录' }))
    expect(screen.getByRole('tab', { name: '待整理' }).getAttribute('aria-selected')).toBe('true')
    expect(domainWorkspaceProps.mock.calls.at(-1)?.[0]).toMatchObject({ preferredSourceId: 'source-1', sourceRequestKey: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/attachments?source_id=source-1',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/extractions'))).toBe(false)
  })

  it('附件失败时保留来源并允许只重试附件', async () => {
    sessionStorage.setItem('homebuild-log-token', 'test-token')
    let attachmentAttempts = 0
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            database: { status: 'ok' },
            storage: { status: 'ok' },
          }),
        })
      }
      if (url.endsWith('/sources')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'source-2',
            input_type: 'text',
            original_text: '带附件记录',
            captured_at: '2026-06-28T10:00:00+08:00',
            reported_time_text: null,
          }),
        })
      }
      attachmentAttempts += 1
      if (attachmentAttempts === 1) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ detail: '附件暂时不可用' }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({ id: 'attachment-2' }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await screen.findByText('记录装修现场')
    fireEvent.change(screen.getByPlaceholderText('记录今天发生的事情…'), {
      target: { value: '带附件记录' },
    })
    fireEvent.change(screen.getByLabelText(/附件/), {
      target: { files: [new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByText('保存记录'))

    const retry = await screen.findByText('来源已保存，重试附件')
    expect(screen.getByText('带附件记录')).toBeTruthy()
    fireEvent.click(retry)
    expect(await screen.findByText('已保存')).toBeTruthy()
    expect(attachmentAttempts).toBe(2)
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/sources') && (init as RequestInit | undefined)?.method === 'POST',
    )).toHaveLength(1)
  })

})
