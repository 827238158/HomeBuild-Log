import { authHeaders } from './api'

export interface SourceEntry {
  id: string
  project_id: string
  original_text: string | null
  captured_at: string
}

export interface AttachmentEntry {
  id: string
  original_filename: string
  media_type: string
  size_bytes: number
}

export interface SourceDetail extends SourceEntry {
  input_type: string
  reported_time_text: string | null
  attachments: AttachmentEntry[]
}

export interface DomainRecord {
  id: string
  record_type: string
  title: string
  status: string
  description: string | null
  archived_at: string | null
  source_refs: Array<{ source_id: string; evidence_excerpt: string | null }>
  [key: string]: unknown
}

export interface ProjectionRecord extends DomainRecord {
  occurred_at: string | null
  time_precision: string
  original_time_text: string | null
  created_at: string
  space_ids: string[]
  spaces: Array<{ id: string; name: string }>
  material_ids: string[]
  materials: Array<{ id: string; name: string }>
  attachment_ids: string[]
  amount_minor?: number
  currency?: string
  direction?: 'expense' | 'refund'
  order_total_minor?: number | null
  outstanding_minor?: number
  net_paid_minor?: number
  refund_minor?: number
  phenomenon?: string
  severity?: string | null
  handling_plan?: string | null
  next_todos?: ProjectionRecord[]
}

export interface TimelineResponse {
  groups: Array<{
    date_key: string
    label: string
    items: Array<{ record: ProjectionRecord; related_records: ProjectionRecord[] }>
  }>
  total: number
}

export interface LedgerResponse {
  totals_by_currency: Array<{
    currency: string
    procurement_total_minor: number
    expense_minor: number
    refund_minor: number
    net_paid_minor: number
    outstanding_minor: number
    overpaid_minor: number
    unallocated_expense_minor: number
    unallocated_refund_minor: number
  }>
  procurements: ProjectionRecord[]
  ledger_entries: ProjectionRecord[]
  warnings: string[]
}

export interface IssueBoardResponse {
  columns: Array<{ status: string; label: string; items: ProjectionRecord[] }>
  total: number
}

export interface SpaceArchiveResponse {
  space: SpaceEntry
  breadcrumbs: Array<{ id: string; name: string }>
  children: SpaceEntry[]
  descendant_ids: string[]
  summary: {
    record_count: number
    unclosed_issue_count: number
    measurement_count: number
    material_count: number
  }
  records_by_type: Record<string, ProjectionRecord[]>
  materials: Array<{ id: string; name: string }>
}

export interface SearchResponse {
  query: string | null
  counts: Record<string, number>
  groups: {
    sources: Array<{ id: string; original_text: string | null; captured_at: string }>
    records: ProjectionRecord[]
    materials: NamedEntity[]
    vendors: NamedEntity[]
    spaces: SpaceEntry[]
  }
  limit: number
  offset: number
}

export interface AuditEntry {
  id: number
  timestamp: string
  action: string
  target_table: string
  target_id: string
}

export interface SpaceEntry {
  id: string
  name: string
  kind: string
  parent_id: string | null
}

export interface NamedEntity {
  id: string
  name: string
  [key: string]: unknown
}

export interface RecordRelation {
  id: string
  from_record_id: string
  to_record_id: string
  relation_type: string
}

export interface LocalSuggestion {
  key: string
  record_type: string
  type_label: string
  summary: string
  evidence: string
  certainty: 'explicit' | 'likely' | 'uncertain'
  certainty_label: string
  selected_by_default: boolean
  payload: Record<string, unknown>
  missing_fields: string[]
  confirmed_record_id?: string | null
}

export interface SuggestionBundle {
  source_id: string
  engine: string
  suggestions: LocalSuggestion[]
  relations: Array<{ from_key: string; to_key: string; relation_type: string }>
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...authHeaders(),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || '请求失败')
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const listSources = () => requestJson<SourceEntry[]>('/api/v1/sources')
export const listRecords = (sourceId?: string, includeArchived = true) =>
  requestJson<DomainRecord[]>(
    `/api/v1/records?include_archived=${includeArchived}${sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : ''}`,
  )
export const createRecord = (payload: Record<string, unknown>) =>
  requestJson<DomainRecord>('/api/v1/records', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const getSuggestions = (sourceId: string) =>
  requestJson<SuggestionBundle>(`/api/v1/sources/${sourceId}/suggestions`)
export const confirmSuggestions = (
  sourceId: string,
  selections: Array<{ key: string; payload: Record<string, unknown> }>,
) => requestJson<{ records: Array<{ key: string; created: boolean; record: DomainRecord }> }>(
  `/api/v1/sources/${sourceId}/suggestions/confirm`,
  { method: 'POST', body: JSON.stringify({ selections }) },
)
export const updateRecord = (id: string, payload: Record<string, unknown>) =>
  requestJson<DomainRecord>(`/api/v1/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
export const setRecordArchived = (id: string, archived: boolean) =>
  requestJson<DomainRecord>(`/api/v1/records/${id}/${archived ? 'archive' : 'restore'}`, {
    method: 'POST',
  })

export const listSpaces = () => requestJson<SpaceEntry[]>('/api/v1/spaces')
export const createSpace = (payload: Record<string, unknown>) =>
  requestJson<SpaceEntry>('/api/v1/spaces', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export type EntityType = 'materials' | 'vendors' | 'participants' | 'stages'
export const listEntities = (type: EntityType) =>
  requestJson<NamedEntity[]>(`/api/v1/${type}`)
export const createEntity = (type: EntityType, payload: Record<string, unknown>) =>
  requestJson<NamedEntity>(`/api/v1/${type}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const listRelations = (recordId?: string) =>
  requestJson<RecordRelation[]>(
    `/api/v1/record-relations${recordId ? `?record_id=${encodeURIComponent(recordId)}` : ''}`,
  )
export const createRelation = (payload: Record<string, unknown>) =>
  requestJson<RecordRelation>('/api/v1/record-relations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const removeRelation = (id: string) =>
  requestJson<void>(`/api/v1/record-relations/${id}`, { method: 'DELETE' })

const withQuery = (path: string, params: Record<string, string>) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value.trim() !== ''),
  )
  return query.size ? `${path}?${query.toString()}` : path
}

export const getRecord = (id: string) =>
  requestJson<ProjectionRecord>(`/api/v1/records/${id}`)
export const getSource = (id: string) =>
  requestJson<SourceDetail>(`/api/v1/sources/${id}`)
export const listRecordAudit = (id: string) =>
  requestJson<AuditEntry[]>(`/api/v1/audit?target_table=records&target_id=${encodeURIComponent(id)}`)
export const getTimeline = (params: Record<string, string> = {}) =>
  requestJson<TimelineResponse>(withQuery('/api/v1/timeline', params))
export const getLedgerSummary = (params: Record<string, string> = {}) =>
  requestJson<LedgerResponse>(withQuery('/api/v1/ledger/summary', params))
export const getIssueBoard = (params: Record<string, string> = {}) =>
  requestJson<IssueBoardResponse>(withQuery('/api/v1/issues/board', params))
export const getSpaceArchive = (id: string) =>
  requestJson<SpaceArchiveResponse>(`/api/v1/spaces/${id}/archive`)
export const searchRecords = (params: Record<string, string>) =>
  requestJson<SearchResponse>(withQuery('/api/v1/search', params))
