import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AttachmentViewer } from './AttachmentViewer'
import { getToken, saveToken } from './token'
import { UNAUTHORIZED_EVENT } from './http'

const attachment = { id: '附件/a', original_filename: '现场.png', media_type: 'image/png', size_bytes: 2048 }
const response = () => ({ ok: true, status: 200, blob: async () => new Blob(['image'], { type: 'image/png' }) })
let fetchMock: ReturnType<typeof vi.fn>
let createUrl: Mock<(object: Blob | MediaSource) => string>
let revokeUrl: Mock<(url: string) => void>
beforeEach(() => {
  fetchMock = vi.fn(); createUrl = vi.fn(() => 'blob:attachment-test'); revokeUrl = vi.fn(() => {})
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl })
  saveToken('attachment-test-token')
})
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

describe('AttachmentViewer', () => {
  it('鉴权放请求头、附件 ID 编码，展示和收起释放 blob URL', async () => {
    fetchMock.mockResolvedValue(response())
    render(<AttachmentViewer attachment={attachment} />)
    fireEvent.click(screen.getByRole('button', { name: '查看附件' }))
    const image = await screen.findByRole('img', { name: '现场.png' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/attachments/%E9%99%84%E4%BB%B6%2Fa/content')
    expect(url).not.toContain('attachment-test-token')
    expect(options.headers).toEqual({ Authorization: 'Bearer attachment-test-token' })
    expect(image.getAttribute('src')).toBe('blob:attachment-test')
    expect(screen.getByRole('link', { name: '下载原件' }).getAttribute('download')).toBe('现场.png')
    fireEvent.click(screen.getByRole('button', { name: '收起附件' }))
    expect(revokeUrl).toHaveBeenCalledWith('blob:attachment-test')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('卸载释放已创建的 blob URL', async () => {
    fetchMock.mockResolvedValue(response())
    const { unmount } = render(<AttachmentViewer attachment={attachment} />)
    fireEvent.click(screen.getByRole('button', { name: '查看附件' }))
    await screen.findByRole('img'); unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:attachment-test')
  })

  it('加载中卸载后不创建 blob URL', async () => {
    let resolve: (value: ReturnType<typeof response>) => void = () => {}
    fetchMock.mockReturnValue(new Promise(value => { resolve = value }))
    const { unmount } = render(<AttachmentViewer attachment={attachment} />)
    fireEvent.click(screen.getByRole('button', { name: '查看附件' })); unmount()
    await act(async () => { resolve(response()); await Promise.resolve() })
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('请求失败保留重试，401 清除令牌并通知上层', async () => {
    const unauthorized = vi.fn(); window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: '登录已失效' }) })
    render(<AttachmentViewer attachment={attachment} />)
    fireEvent.click(screen.getByRole('button', { name: '查看附件' }))
    expect((await screen.findByRole('alert')).textContent).toBe('登录已失效')
    expect(getToken()).toBeNull(); expect(unauthorized).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValue(response())
    fireEvent.click(screen.getByRole('button', { name: '重试查看附件' }))
    await screen.findByRole('img')
    window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
  })

  it('加载中卸载会中止请求，避免持续下载大附件', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<AttachmentViewer attachment={attachment} />)
    fireEvent.click(screen.getByRole('button', { name: '查看附件' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal | undefined
    expect(signal).toBeDefined()
    unmount(); expect(signal?.aborted).toBe(true)
  })
})
