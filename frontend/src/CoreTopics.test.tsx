import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./AnalyticsViews', () => ({ OverviewView: () => <p>首页概览</p>, AiAnalyticsView: () => null, RecordsAnalyticsView: () => null }))
vi.mock('./WorkspaceAtmosphere', () => ({ WorkspaceAtmosphere: () => null }))
vi.mock('./TopicsView', () => ({ TopicsView: ({ onOpenRecord, onOpenResearch, onOpenPitfall, onCreate }: {
  onOpenRecord: (id: string) => void; onOpenResearch: (id: string) => void
  onOpenPitfall: (id: string) => void; onCreate: (kind: 'ledger' | 'issue' | 'research' | 'pitfall', id: string) => void
}) => <section aria-label="主题测试视图"><button onClick={() => onOpenRecord('issue1')}>查看事项</button><button onClick={() => onOpenResearch('research1')}>查看调研</button><button onClick={() => onOpenPitfall('pitfall1')}>查看踩坑</button>{(['ledger', 'issue', 'research', 'pitfall'] as const).map(kind => <button key={kind} onClick={() => onCreate(kind, 'topic1')}>主题新增{kind}</button>)}</section> }))
vi.mock('./BusinessEntryForm', () => ({ BusinessEntryForm: ({ initialTopicId, kind }: { initialTopicId?: string; kind: string }) => <p>创建{kind}所属{initialTopicId}</p> }))
vi.mock('./ResearchView', () => ({ ResearchView: ({ initialTopicId, initialResearchId }: { initialTopicId?: string; initialResearchId?: string }) => <p>调研定位{initialResearchId}所属{initialTopicId}</p> }))
vi.mock('./PitfallsView', () => ({ PitfallsView: ({ initialTopicId, initialPitfallId }: { initialTopicId?: string; initialPitfallId?: string }) => <p>踩坑定位{initialPitfallId}所属{initialTopicId}</p> }))
vi.mock('./RecordDetail', () => ({ RecordDetail: ({ recordId, onClose }: { recordId: string; onClose: () => void }) => <section role="dialog"><p>详情{recordId}</p><button onClick={onClose}>关闭详情</button></section> }))
vi.mock('./domainApi', () => ({
  listEntities: vi.fn(async () => []), listSpaces: vi.fn(async () => []),
  getLedgerSummary: vi.fn(async () => ({ totals: { expense_minor: 0, refund_minor: 0, income_minor: 0, net_expense_minor: 0 }, ledger_entries: [], analytics: { money_trend: [], payment_composition: [], vendor_distribution: [] } })),
  getIssueBoard: vi.fn(async () => ({ total: 0, columns: [], analytics: { status_distribution: [], severity_distribution: [], space_distribution: [] } })),
}))

import { CoreViews } from './CoreViews'
afterEach(cleanup)
const navigate = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '核心功能' })).getByRole('button', { name }))

it('主题入口保留业务导航，按类型传递创建归属，返回主题仍保留挂载', async () => {
  render(<CoreViews>随手记内容</CoreViews>)
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '主题新增ledger' }))
  await waitFor(() => expect(screen.getByText('创建ledger所属topic1')).toBeTruthy())
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '主题新增issue' }))
  await waitFor(() => expect(screen.getByText('创建issue所属topic1')).toBeTruthy())
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '主题新增research' }))
  expect(screen.getByText('调研定位所属topic1')).toBeTruthy()
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '主题新增pitfall' }))
  expect(screen.getByText('踩坑定位所属topic1')).toBeTruthy()
  navigate('主题')
  expect(screen.getByRole('region', { name: '主题测试视图' })).toBeTruthy()
})

it('主题的记录、调研与踩坑分别进入原有详情入口', () => {
  render(<CoreViews>随手记内容</CoreViews>)
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '查看事项' }))
  expect(screen.getByText('详情issue1')).toBeTruthy()
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '查看调研' }))
  expect(screen.getByText('调研定位research1所属')).toBeTruthy()
  navigate('主题')
  fireEvent.click(screen.getByRole('button', { name: '查看踩坑' }))
  expect(screen.getByText('踩坑定位pitfall1所属')).toBeTruthy()
})
