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
  // FastAPI 字段校验返回列表，逐项解释而不是退化成 HTTP 状态码。
  const validationDetails = Array.isArray(body.detail) ? body.detail.map((item: unknown) => {
    if (!item || typeof item !== 'object') return ''
    const error = item as { loc?: unknown; type?: string; ctx?: { max_length?: number } }
    const labels: Record<string, string> = {
      title: '标题', status: '状态', record_type: '记录类型', severity: '严重程度',
      phenomenon: '问题描述', amount_minor: '金额', vendor_id: '交易对象（商家）',
      payment_kind: '款项性质', ledger_kind: '账目类型', direction: '收支方向',
      occurred_date: '发生日期', payment_date: '交易日期', completed_at: '完成日期',
      question: '调研问题', topic: '决策主题', measurement_role: '尺寸用途',
      object_name: '测量对象', value: '尺寸数值', unit: '尺寸单位',
      original_text: '来源文字', source_refs: '原始来源', event_kind: '事件类型',
    }
    const field = Array.isArray(error.loc) ? [...error.loc].reverse().find((part) => typeof part === 'string' && labels[part]) : undefined
    const label = typeof field === 'string' ? labels[field] : '提交内容'
    if (error.type === 'missing') return `${label}未填写，请补齐`
    if (error.type === 'literal_error') return field === 'severity' ? '严重程度请选择低、中或高' : `${label}选项不正确，请重新选择`
    if (error.type?.startsWith('date')) return `${label}格式不正确，请填写有效日期或时间`
    if (error.type === 'greater_than') return `${label}必须大于0`
    if (error.type === 'string_too_short' || error.type === 'too_short') return `${label}不能为空`
    if (error.type === 'string_too_long') return `${label}过长，最多允许${error.ctx?.max_length}个字符`
    return `${label}格式不正确，请检查后重试`
  }).filter(Boolean) : []
  const detail = typeof body.detail === 'string' && body.detail.trim()
    ? body.detail.trim()
    : validationDetails.length ? `${[...new Set(validationDetails)].join('；')}。`
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
