import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestJson, UNAUTHORIZED_EVENT } from './http'
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
})
