import { getToken, clearToken } from './token'
import { API_BASE } from './config'

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
  project_id: string
  input_type: string
  original_text: string | null
  captured_at: string
  reported_time_text: string | null
  updated_at: string
  revision: number
}

export interface AttachmentResponse {
  id: string
  source_id: string | null
  original_filename: string
  media_type: string
  size_bytes: number
  sha256_hex: string
  created_at: string
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`, { signal })
  if (!response.ok) {
    throw new Error('本地服务暂不可用')
  }
  return (await response.json()) as HealthResponse
}

export async function login(password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
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
  const response = await fetch(`${API_BASE}/sources`, {
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

export async function uploadAttachment(
  sourceId: string,
  file: File,
): Promise<AttachmentResponse> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(
    `${API_BASE}/attachments?source_id=${encodeURIComponent(sourceId)}`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    },
  )
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || '附件上传失败')
  }
  return (await response.json()) as AttachmentResponse
}
