import { API_BASE } from './config'
import { authHeaders, requestJson } from './http'

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
  return requestJson<LoginResponse>('/auth/login', {
    method: 'POST', body: JSON.stringify({ password }), auth: false,
  })
}

export async function createSource(
  text: string,
  reportedTime?: string,
): Promise<SourceResponse> {
  return requestJson<SourceResponse>('/sources', {
    method: 'POST', body: JSON.stringify({
      original_text: text,
      reported_time_text: reportedTime || null,
    }),
  })
}

export { authHeaders }

export async function uploadAttachment(
  sourceId: string,
  file: File,
): Promise<AttachmentResponse> {
  const form = new FormData()
  form.append('file', file)
  return requestJson<AttachmentResponse>(`/attachments?source_id=${encodeURIComponent(sourceId)}`, {
    method: 'POST', body: form,
  })
}
