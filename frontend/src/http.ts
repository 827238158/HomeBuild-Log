import { API_BASE } from './config'
import { clearToken, getToken } from './token'

export const UNAUTHORIZED_EVENT = 'homebuild:unauthorized'

export interface RequestOptions extends RequestInit {
  auth?: boolean
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { detail?: unknown }
  return typeof body.detail === 'string' ? body.detail : '请求失败，请稍后重试。'
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, headers, ...init } = options
  const response = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? authHeaders() : {}),
      ...headers,
    },
  })
  if (!response.ok) {
    if (response.status === 401 && auth) {
      clearToken()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new Error(await errorMessage(response))
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}
