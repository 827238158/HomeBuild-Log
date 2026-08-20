import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError, requestJson, UNAUTHORIZED_EVENT } from './http'
import { getToken, saveToken } from './token'

describe('requestJson', () => {
  beforeEach(() => sessionStorage.clear())

  it('401 清除令牌并广播全局退出事件', async () => {
    saveToken('expired')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '登录已失效' }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
    const listener = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, listener)
    await expect(requestJson('/records')).rejects.toThrow('登录已失效')
    expect(getToken()).toBeNull()
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(UNAUTHORIZED_EVENT, listener)
  })

  it('普通业务错误不会清除令牌', async () => {
    saveToken('valid')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '字段不合法' }), { status: 422, headers: { 'Content-Type': 'application/json' } })))
    await expect(requestJson('/records')).rejects.toThrow('字段不合法')
    expect(getToken()).toBe('valid')
  })

  it('保留后端业务错误码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'DATABASE_REVISION_MISMATCH',
      message: '数据库结构版本落后，请先完成数据库迁移。',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })))

    const error = await requestJson('/health', { auth: false }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 503, code: 'DATABASE_REVISION_MISMATCH' })
    expect((error as Error).message).toContain('错误码：DATABASE_REVISION_MISMATCH')
  })

  it('无业务码时保留 HTTP 状态码', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })))
    await expect(requestJson('/pitfalls')).rejects.toThrow(
      '服务端返回 HTTP 500。（错误码：HTTP_500）',
    )
  })
})
