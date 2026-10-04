import { requestJson } from './http'

export type ResearchStatus = 'collecting' | 'comparing' | 'concluded' | 'archived'
export interface ResearchEntry {
  id: string; record_id: string; research_date: string; content: string; sources: string[]; uncertainties: string | null; created_at: string
}
export interface ResearchConclusion {
  id: string; record_id: string; conclusion: string | null; reason: string; entry_id: string | null; created_at: string
}
export interface ResearchTopic {
  id: string; title: string; question: string; description: string | null; status: ResearchStatus; conclusion: string | null; limitations: string | null; created_at: string; updated_at: string
  entries: ResearchEntry[]; conclusion_history: ResearchConclusion[]
}
export interface ResearchList { items: ResearchTopic[]; summary: Record<'total' | ResearchStatus, number> }
const base = '/research'
export const listResearch = (state: ResearchStatus | 'all' = 'all') => requestJson<ResearchList>(`${base}?state=${state}`)
export const getResearch = (id: string) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}`)
export const createResearch = (title: string) => requestJson<ResearchTopic>(base, { method: 'POST', body: JSON.stringify({ title }) })
export const updateResearchStatus = (id: string, status: ResearchStatus) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) })
export const appendResearchEntry = (id: string, data: { research_date: string; content: string; sources: string[]; uncertainties: string }) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}/entries`, { method: 'POST', body: JSON.stringify(data) })
export const reviseResearchConclusion = (id: string, data: { conclusion: string | null; reason: string; entry_id?: string }) => requestJson<ResearchTopic>(`${base}/${encodeURIComponent(id)}/conclusions`, { method: 'POST', body: JSON.stringify(data) })
