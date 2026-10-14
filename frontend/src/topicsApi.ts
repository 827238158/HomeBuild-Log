import { requestJson } from './http'
import type { DomainRecord, PitfallEntry } from './domainApi'

export type TopicStatus = 'active' | 'archived'
export interface Topic {
  id: string
  project_id: string
  name: string
  goal: string | null
  current_situation: string | null
  status: TopicStatus
  created_at: string
  updated_at: string
}
export interface TopicDetail extends Topic { records: DomainRecord[]; pitfalls: PitfallEntry[] }
export interface TopicList { items: Topic[]; summary: { total: number; active: number; archived: number } }
export interface TopicActivity {
  id: string
  activity_kind: string
  object_kind: 'record' | 'research_entry' | 'issue_activity' | 'pitfall' | 'pitfall_resolution'
  object_id: string
  parent_id: string | null
  record_type: string
  title: string
  content: string | null
  occurred_at: string
  date_missing: boolean
  created_at: string
  previous_status: string | null
  next_status: string | null
}
export interface TopicOverview { pending_issues: DomainRecord[]; recent_activities: TopicActivity[] }
export interface TopicActivities { items: TopicActivity[]; total: number }
export interface TopicInput { name: string; goal?: string; current_situation?: string }
const path = (id: string) => `/topics/${encodeURIComponent(id)}`
export const listTopics = (search = '', state: TopicStatus | 'all' = 'all') => {
  const query = new URLSearchParams({ search, state })
  return requestJson<TopicList>(`/topics?${query}`)
}
export const createTopic = (payload: TopicInput) => requestJson<Topic>('/topics', { method: 'POST', body: JSON.stringify(payload) })
export const getTopic = (id: string) => requestJson<TopicDetail>(path(id))
export const updateTopic = (id: string, payload: Partial<TopicInput> & { status?: TopicStatus }) => requestJson<Topic>(path(id), { method: 'PATCH', body: JSON.stringify(payload) })
export const getTopicOverview = (id: string) => requestJson<TopicOverview>(`${path(id)}/overview`)
export const getTopicActivities = (id: string, recordType = '', offset = 0, limit = 30) => {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (recordType) query.set('record_type', recordType)
  return requestJson<TopicActivities>(`${path(id)}/activities?${query}`)
}
export const linkTopicRecord = (id: string, recordId: string, expectedVersion?: number) => requestJson<TopicDetail>(`${path(id)}/records/${encodeURIComponent(recordId)}?expected_version=${expectedVersion ?? ''}`, { method: 'PUT' })
export const unlinkTopicRecord = (id: string, recordId: string, expectedVersion?: number) => requestJson<TopicDetail>(`${path(id)}/records/${encodeURIComponent(recordId)}?expected_version=${expectedVersion ?? ''}`, { method: 'DELETE' })
export const linkTopicPitfall = (id: string, pitfallId: string) => requestJson<TopicDetail>(`${path(id)}/pitfalls/${encodeURIComponent(pitfallId)}`, { method: 'PUT' })
export const unlinkTopicPitfall = (id: string, pitfallId: string) => requestJson<TopicDetail>(`${path(id)}/pitfalls/${encodeURIComponent(pitfallId)}`, { method: 'DELETE' })
