import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendResearchEntry, listResearch, reviseResearchConclusion } from './researchApi'

describe('research API路径', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('只添加一次API前缀并编码主题id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await listResearch('archived')
    await appendResearchEntry('a/b', { research_date: '2026-10-03', content: '调研', sources: [], uncertainties: '' })
    await reviseResearchConclusion('a/b', { conclusion: null, reason: '撤回' })
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/v1/research?state=archived', '/api/v1/research/a%2Fb/entries', '/api/v1/research/a%2Fb/conclusions'])
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ conclusion: null, reason: '撤回' })
  })
})
