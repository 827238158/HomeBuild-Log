export interface HealthResponse {
  status: 'ok'
  database: { status: 'ok' }
  storage: { status: 'ok' }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/v1/health', { signal })
  if (!response.ok) {
    throw new Error('本地服务暂不可用')
  }
  return (await response.json()) as HealthResponse
}

