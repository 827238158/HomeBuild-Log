import { getToken, clearToken } from './token'

export interface HealthResponse {
  status: 'ok'
  database: { status: 'ok' }
  storage: { status: 'ok' }
}

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface SourceResponse {
  id: string
  input_type: string
  original_text: string | null
  captured_at: string
  reported_time_text: string | null
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', { signal })
  if (!response.ok) {
    throw new Error('本地服务暂不可用')
  }
  return (await response.json()) as HealthResponse
}

export async function login(password: string): Promise<LoginResponse> {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || '登录失败')
  }
  return (await response.json()) as LoginResponse
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  if (!token) {
    return {}
  }
  return { Authorization: `Bearer ${token}` }
}

export async function createSource(
  text: string,
  reportedTime?: string,
): Promise<SourceResponse> {
  const response = await fetch('/api/v1/sources', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      original_text: text,
      reported_time_text: reportedTime || null,
    }),
  })
  if (!response.ok) {
    clearToken()
    throw new Error('保存失败')
  }
  return (await response.json()) as SourceResponse
}
