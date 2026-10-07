import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendResearchEntry, listResearch, updateResearchStatus } from './researchApi'

describe('research API路径', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('只添加一次API前缀并编码主题id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await listResearch('archived')
    await appendResearchEntry('a/b', { research_date: '2026-10-03', content: '调研', sources: [], uncertainties: '' })
    await updateResearchStatus('a/b', 'comparing')
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/v1/research?state=archived', '/api/v1/research/a%2Fb/entries', '/api/v1/research/a%2Fb'])
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ status: 'comparing' })
  })
})
