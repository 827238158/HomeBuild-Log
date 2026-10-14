import { requestJson } from './http'

export type ResearchStatus = 'collecting' | 'comparing' | 'archived'
export interface ResearchEntry {
  id: string; record_id: string; research_date: string; content: string; sources: string[]; uncertainties: string | null; created_at: string
}
export interface ResearchConclusion {
  id: string; record_id: string; conclusion: string | null; reason: string; entry_id: string | null; created_at: string
}
export interface ResearchAssociations {
  space_ids?: string[]; material_ids?: string[]; participant_ids?: string[]; related_record_ids?: string[]; stage_id?: string | null
}
export interface ResearchTopic extends ResearchAssociations {
  version?: number
  topic_ids?: string[]
  id: string; title: string; question: string; description: string | null; status: ResearchStatus | 'concluded'; conclusion?: string | null; limitations: string | null; created_at: string; updated_at: string
  entries: ResearchEntry[]; conclusion_history?: ResearchConclusion[]
}
export interface ResearchList { items: ResearchTopic[]; summary: Record<'total' | ResearchStatus, number> }
const base = '/research'
export const listResearch = (state: ResearchStatus | 'all' = 'all') => requestJson<ResearchList>(`${base}?state=${state}`)
export const getResearch = (id: string) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}`)
export const createResearch = (title: string, topic_ids?: string[], associations: ResearchAssociations = {}) => requestJson<ResearchTopic>(base, { method: 'POST', body: JSON.stringify({ title, topic_ids, ...associations }) })
export const updateResearchStatus = (id: string, status: ResearchStatus, expectedVersion?: number) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status, expected_version: expectedVersion }) })
export const appendResearchEntry = (id: string, data: { research_date: string; content: string; sources: string[]; uncertainties: string }) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}/entries`, { method: 'POST', body: JSON.stringify(data) })

export const updateResearchTopics = (id: string, topic_ids: string[], associations: ResearchAssociations = {}, expectedVersion?: number) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ topic_ids, ...associations, expected_version: expectedVersion }) })
