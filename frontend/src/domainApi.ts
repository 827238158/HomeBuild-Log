import { authHeaders } from './api'

export interface SourceEntry {
  id: string
  project_id: string
  original_text: string | null
  captured_at: string
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

export const listRelations = () =>
  requestJson<RecordRelation[]>('/api/v1/record-relations')
export const createRelation = (payload: Record<string, unknown>) =>
  requestJson<RecordRelation>('/api/v1/record-relations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const removeRelation = (id: string) =>
  requestJson<void>(`/api/v1/record-relations/${id}`, { method: 'DELETE' })
