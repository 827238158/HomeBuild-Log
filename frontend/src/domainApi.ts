import { API_BASE } from './config'
import { requestJson as request } from './http'

export interface SourceEntry {
  id: string
  project_id: string
  input_type: string
  original_text: string | null
  captured_at: string
  reported_time_text: string | null
  updated_at: string
  revision: number
  analysis_status?: 'unprocessed' | 'pending' | 'partially_confirmed' | 'confirmed' | 'reviewed'
  generated_record_count?: number
  pending_candidate_count?: number
  confirmed_candidate_count?: number
  ignored_candidate_count?: number
}

export interface AttachmentEntry {
  id: string
  original_filename: string
  media_type: string
  size_bytes: number
}

export interface SourceDetail extends SourceEntry {
  attachments: AttachmentEntry[]
}

export interface DomainRecord {
  id: string
  record_type: string
  title: string
  status: string
  description: string | null
  archived_at: string | null
  source_refs: Array<{
    source_id: string
    evidence_excerpt: string | null
    source_revision: number
    needs_review: boolean
  }>
  [key: string]: unknown
}

export interface ProjectionRecord extends DomainRecord {
  occurred_date: string | null
  original_time_text: string | null
  created_at: string
  space_ids: string[]
  spaces: Array<{ id: string; name: string }>
  material_ids: string[]
  materials: Array<{ id: string; name: string }>
  participant_ids: string[]
  participants: Array<{ id: string; name: string }>
  stage_id?: string | null
  attachment_ids: string[]
  amount_minor?: number
  currency?: string
  direction?: 'expense' | 'refund' | 'income'
  vendor_id?: string | null
  vendor?: { id: string; name: string } | null
  refund_minor?: number
  phenomenon?: string
  severity?: string | null
  handling_plan?: string | null
  promised_date?: string | null
  actual_result?: string | null
  completed_at?: string | null
  stage?: { id: string; name: string } | null
}

export interface DistributionItem {
  key: string
  label: string
  value: number
}

export interface BaseAnalytics {
  total: number
  unknown_date_count: number
  status_distribution: DistributionItem[]
  type_distribution: DistributionItem[]
  time_trend: DistributionItem[]
}

export interface TimelineResponse {
  groups: Array<{
    date_key: string
    label: string
    items: Array<{ record: ProjectionRecord; related_records: ProjectionRecord[] }>
  }>
  total: number
  analytics: BaseAnalytics
}

export interface LedgerResponse {
  totals: {
    expense_minor: number
    refund_minor: number
    income_minor: number
    net_expense_minor: number
  }
  ledger_entries: ProjectionRecord[]
  analytics: {
    money_trend: Array<{
      key: string; label: string; expense_minor: number; refund_minor: number; income_minor: number
    }>
    payment_composition: DistributionItem[]
    vendor_distribution: DistributionItem[]
  }
}

export interface IssueBoardResponse {
  columns: Array<{ status: string; label: string; items: ProjectionRecord[] }>
  total: number
  analytics: {
    status_distribution: DistributionItem[]
    space_distribution: DistributionItem[]
    severity_distribution: DistributionItem[]
  }
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
  analytics: {
    type_distribution: DistributionItem[]
    issue_status_distribution: DistributionItem[]
    expense_minor: number
    refund_minor: number
    income_minor: number
  }
}

export interface OverviewResponse {
  as_of_date: string
  horizon_date: string
  summary: { open_issue_count: number; overdue_count: number; upcoming_count: number }
  open_issues: ProjectionRecord[]
  overdue: ProjectionRecord[]
  upcoming: ProjectionRecord[]
  recent_records: ProjectionRecord[]
  stage_distribution: DistributionItem[]
}

export interface RecordsAnalyticsResponse {
  summary: BaseAnalytics
  specific: {
    dimension?: string
    distribution?: DistributionItem[]
    unit_distribution?: DistributionItem[]
    overdue_count?: number
  }
  records: ProjectionRecord[]
}

export interface AiAnalyticsOverview {
  range: string
  summary: {
    request_count: number; success_rate: number; fallback_rate: number
    average_duration_ms: number; p95_duration_ms: number
    total_tokens: number; token_request_count: number
  }
  trend: Array<{
    key: string; label: string; requests: number; successes: number; fallbacks: number
    average_duration_ms: number; total_tokens: number
  }>
  engine_distribution: DistributionItem[]
  error_distribution: DistributionItem[]
}

export interface AiAnalyticsRun {
  request_id: string
  started_at: string
  requested_engine: string
  final_engine: string
  final_model: string | null
  status: 'succeeded' | 'failed'
  fallback: boolean
  fallback_reason: string | null
  duration_ms: number
  total_tokens: number | null
  error_code: string | null
  error_summary: string | null
}

export interface AiAnalyticsRunsResponse {
  items: AiAnalyticsRun[]
  total: number
  limit: number
  offset: number
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

export type CandidateCertainty =
  | 'explicit'
  | 'inferred'
  | 'calculated'
  | 'uncertain'
  | 'missing'

export interface CandidateSuggestion extends Omit<LocalSuggestion, 'certainty'> {
  certainty: CandidateCertainty
  review_state: 'active' | 'deferred' | 'confirmed'
  deferred_at: string | null
  confirmed_record_id: string | null
}

export interface CandidateBundle {
  id: string
  source_id: string
  source_revision: number
  extraction_run_id: string
  request_id: string
  requested_engine: 'auto' | 'ai' | 'local'
  engine: string
  fallback_reason: string | null
  status: 'pending' | 'partially_confirmed' | 'confirmed' | 'reviewed' | 'superseded'
  version: number
  created_at: string
  updated_at: string
  suggestions: CandidateSuggestion[]
  relations: Array<{ from_key: string; to_key: string; relation_type: string }>
  warnings: string[]
}

export interface ExtractionRun {
  id: string
  request_id: string
  source_id: string
  attempt_no: number
  requested_engine: string
  provider: string | null
  model: string | null
  engine: string
  status: 'succeeded' | 'failed'
  duration_ms: number
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  error_code: string | null
  error_message: string | null
  started_at: string
  finished_at: string
}

export interface SourceDeletionImpact {
  source_id: string
  attachments: number
  candidate_bundles: number
  extraction_runs: number
  exclusive_records: number
  shared_records: number
  affected_relations: number
}

export interface SourceDeletionResult extends SourceDeletionImpact {
  deleted_physical_files: number
  file_cleanup_warnings: string[]
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  return request<T>(url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url, init)
}

export const listSources = () => requestJson<SourceEntry[]>(`${API_BASE}/sources`)
export const updateSource = (
  id: string,
  payload: { original_text?: string | null; reported_time_text?: string | null },
) => requestJson<SourceEntry>(`${API_BASE}/sources/${id}`, {
  method: 'PATCH',
  body: JSON.stringify(payload),
})
export const getSourceDeletionImpact = (id: string) =>
  requestJson<SourceDeletionImpact>(`${API_BASE}/sources/${id}/deletion-impact`)
export const deleteSource = (id: string) =>
  requestJson<SourceDeletionResult>(`${API_BASE}/sources/${id}`, { method: 'DELETE' })
export const listRecords = (sourceId?: string, includeArchived = true) =>
  requestJson<DomainRecord[]>(
    `${API_BASE}/records?include_archived=${includeArchived}${sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : ''}`,
  )
export const createRecord = (payload: Record<string, unknown>) =>
  requestJson<DomainRecord>(`${API_BASE}/records`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const createExtraction = (
  sourceId: string,
  engine: 'auto' | 'ai' | 'local' = 'auto',
) => requestJson<CandidateBundle>(
  `${API_BASE}/sources/${sourceId}/extractions?engine=${engine}`,
  { method: 'POST' },
)
export const getCandidateBundle = (bundleId: string) =>
  requestJson<CandidateBundle>(`${API_BASE}/candidate-bundles/${bundleId}`)
export const getLatestCandidateBundle = (sourceId: string) =>
  requestJson<CandidateBundle | null>(
    `${API_BASE}/sources/${sourceId}/candidate-bundles/latest`,
  )
export const confirmCandidateBundle = (
  bundleId: string,
  expectedVersion: number,
  selections: Array<{ key: string; payload: Record<string, unknown> }>,
  ignoredKeys: string[] = [],
) => requestJson<{
  records: Array<{ key: string; created: boolean; record: DomainRecord }>
  bundle: CandidateBundle
}>(`${API_BASE}/candidate-bundles/${bundleId}/confirm`, {
  method: 'POST',
  body: JSON.stringify({ expected_version: expectedVersion, selections, ignored_keys: ignoredKeys }),
})
export const deferCandidate = (bundleId: string, candidateKey: string, expectedVersion: number) =>
  requestJson<CandidateBundle>(
    `${API_BASE}/candidate-bundles/${bundleId}/suggestions/${encodeURIComponent(candidateKey)}/defer`,
    { method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }) },
  )
export const listExtractionRuns = (sourceId?: string) => requestJson<ExtractionRun[]>(
  `${API_BASE}/extraction-runs${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`,
)
export const updateRecord = (id: string, payload: Record<string, unknown>) =>
  requestJson<DomainRecord>(`${API_BASE}/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
export const deleteRecord = (id: string) =>
  requestJson<void>(`${API_BASE}/records/${id}`, { method: 'DELETE' })
export const setRecordArchived = (id: string, archived: boolean) =>
  requestJson<DomainRecord>(`${API_BASE}/records/${id}/${archived ? 'archive' : 'restore'}`, {
    method: 'POST',
  })
export const reviewRecordSource = (recordId: string, sourceId: string) =>
  requestJson<DomainRecord>(
    `${API_BASE}/records/${recordId}/source-reviews/${sourceId}`,
    { method: 'POST' },
  )

export const listSpaces = () => requestJson<SpaceEntry[]>(`${API_BASE}/spaces`)
export const createSpace = (payload: Record<string, unknown>) =>
  requestJson<SpaceEntry>(`${API_BASE}/spaces`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const deleteSpace = (id: string) =>
  requestJson<void>(`${API_BASE}/spaces/${id}`, { method: 'DELETE' })

export type EntityType = 'materials' | 'vendors' | 'participants' | 'stages'
export const listEntities = (type: EntityType) =>
  requestJson<NamedEntity[]>(`${API_BASE}/${type}`)
export const createEntity = (type: EntityType, payload: Record<string, unknown>) =>
  requestJson<NamedEntity>(`${API_BASE}/${type}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const deleteEntity = (type: EntityType, id: string) =>
  requestJson<void>(`${API_BASE}/${type}/${id}`, { method: 'DELETE' })

export const listRelations = (recordId?: string) =>
  requestJson<RecordRelation[]>(
    `${API_BASE}/record-relations${recordId ? `?record_id=${encodeURIComponent(recordId)}` : ''}`,
  )
export const createRelation = (payload: Record<string, unknown>) =>
  requestJson<RecordRelation>(`${API_BASE}/record-relations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
export const removeRelation = (id: string) =>
  requestJson<void>(`${API_BASE}/record-relations/${id}`, { method: 'DELETE' })

const withQuery = (path: string, params: Record<string, string>) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value.trim() !== ''),
  )
  return query.size ? `${path}?${query.toString()}` : path
}

export const getRecord = (id: string) =>
  requestJson<ProjectionRecord>(`${API_BASE}/records/${id}`)
export const getSource = (id: string) =>
  requestJson<SourceDetail>(`${API_BASE}/sources/${id}`)
export const listRecordAudit = (id: string) =>
  requestJson<AuditEntry[]>(`${API_BASE}/audit?target_table=records&target_id=${encodeURIComponent(id)}`)
export const getTimeline = (params: Record<string, string> = {}) =>
  requestJson<TimelineResponse>(withQuery(`${API_BASE}/timeline`, params))
export const getLedgerSummary = (params: Record<string, string> = {}) =>
  requestJson<LedgerResponse>(withQuery(`${API_BASE}/ledger/summary`, params))
export const getIssueBoard = (params: Record<string, string> = {}) =>
  requestJson<IssueBoardResponse>(withQuery(`${API_BASE}/issues/board`, params))
export const getSpaceArchive = (id: string) =>
  requestJson<SpaceArchiveResponse>(`${API_BASE}/spaces/${id}/archive`)
export const searchRecords = (params: Record<string, string>) =>
  requestJson<SearchResponse>(withQuery(`${API_BASE}/search`, params))
export const getOverview = () => requestJson<OverviewResponse>(`${API_BASE}/overview`)
export const getRecordsAnalytics = (params: Record<string, string> = {}) =>
  requestJson<RecordsAnalyticsResponse>(withQuery(`${API_BASE}/records/analytics`, params))
export const getAiAnalyticsOverview = (range = '30d') =>
  requestJson<AiAnalyticsOverview>(`${API_BASE}/ai-analytics/overview?range=${encodeURIComponent(range)}`)
export const getAiAnalyticsRuns = (range = '30d', offset = 0) =>
  requestJson<AiAnalyticsRunsResponse>(
    `${API_BASE}/ai-analytics/runs?range=${encodeURIComponent(range)}&offset=${offset}`,
  )
