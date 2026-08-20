import { API_BASE } from './config'
import { clearToken, getToken } from './token'

export const UNAUTHORIZED_EVENT = 'homebuild:unauthorized'

export interface RequestOptions extends RequestInit {
  auth?: boolean
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function responseError(response: Response): Promise<HttpError> {
  const body = await response.json().catch(() => ({})) as {
    detail?: unknown
    message?: unknown
    code?: unknown
  }
  const code = typeof body.code === 'string' && body.code.trim()
    ? body.code.trim()
    : `HTTP_${response.status}`
  const detail = typeof body.detail === 'string' && body.detail.trim()
    ? body.detail.trim()
    : typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : `服务端返回 HTTP ${response.status}。`
  return new HttpError(`${detail}（错误码：${code}）`, response.status, code)
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
    throw await responseError(response)
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}
