import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArchivesView } from './ArchivesView'
import * as api from './domainApi'
import { HttpError } from './http'
import { confirmNavigation } from './navigationGuard'

vi.mock('./domainApi', () => ({
  createEntity: vi.fn(),
  createSpace: vi.fn(),
  deleteEntity: vi.fn(),
  deleteSpace: vi.fn(),
  listEntities: vi.fn(),
  listSpaces: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listEntities).mockResolvedValue([])
  vi.mocked(api.listSpaces).mockResolvedValue([])
})

afterEach(() => vi.restoreAllMocks())

it('按类型搜索档案，并区分历史重复和规格不同的同名材料', async () => {
  vi.mocked(api.listEntities).mockImplementation(async type => type === 'materials' ? [
    { id: 'one', name: '花砖', brand: 'ＡＢＣ', model: '01', duplicate: true },
    { id: 'two', name: '花砖', brand: 'abc', model: '01', duplicate: true },
    { id: 'three', name: '花砖', brand: 'ABC', model: '02' },
  ] : [])
  render(<ArchivesView initialType="vendors" />)
  fireEvent.click(screen.getByRole('button', { name: '材料' }))
  await screen.findByRole('list', { name: '已有材料' })
  expect(screen.getAllByText('历史重复')).toHaveLength(2)
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索材料' }), { target: { value: 'ＡＢＣ 02' } })
  const list = screen.getByRole('list', { name: '已有材料' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  expect(within(list).queryByText('历史重复')).toBeNull()
})

it.each([
  ['vendors', '商家'],
  ['materials', '材料'],
  ['participants', '参与人'],
  ['spaces', '空间'],
  ['stages', '装修阶段'],
] as const)('从管理页新增%s并定位到保存的档案', async (type, label) => {
  const house = { id: 'house', name: '整套房屋', kind: 'house', parent_id: null }
  const item = { id: 'new-item', name: `新${label}` }
  const space = { ...item, kind: 'room', parent_id: house.id }
  vi.mocked(api.listSpaces).mockResolvedValue([house])
  vi.mocked(api.createSpace).mockImplementation(async () => {
    vi.mocked(api.listSpaces).mockResolvedValue([house, space])
    return space
  })
  vi.mocked(api.createEntity).mockImplementation(async () => {
    vi.mocked(api.listEntities).mockResolvedValue([item])
    return item
  })
  render(<ArchivesView initialType={type} />)
  const add = screen.getByRole('button', { name: `新增${label}` })
  await waitFor(() => expect(add).toHaveProperty('disabled', false))
  fireEvent.click(add)
  const name = screen.getByLabelText(`${label}名称`)
  fireEvent.change(name, { target: { value: item.name } })
  if (type === 'spaces') fireEvent.change(screen.getByLabelText('上级空间'), { target: { value: house.id } })
  fireEvent.submit(name.closest('form')!)
  expect(await screen.findByText(`${label}“${item.name}”已新增。`)).toBeTruthy()
  if (type === 'spaces') expect(api.createSpace).toHaveBeenCalledWith({ name: item.name, kind: 'room', parent_id: house.id })
  else expect(api.createEntity).toHaveBeenCalledWith(type, { name: item.name })
})

it('冲突后保留新增表单，选用现有档案时清除筛选并聚焦对应列表行', async () => {
  const match = { id: 'vendor-race', name: '砖世界', contact: '市场店' }
  vi.mocked(api.createEntity).mockRejectedValue(new HttpError('已有相同档案', 409, 'archive_duplicate', { matches: [match] }))
  render(<ArchivesView initialType="vendors" />)
  const add = screen.getByRole('button', { name: '新增商家' })
  await waitFor(() => expect(add).toHaveProperty('disabled', false))
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索商家' }), { target: { value: '砖世界' } })
  fireEvent.click(add)
  const name = screen.getByLabelText('商家名称')
  expect(name).toHaveProperty('value', '砖世界')
  expect(document.activeElement).toBe(name)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  expect(confirmNavigation()).toBe(false)
  fireEvent.submit(name.closest('form')!)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('已存在相同档案'))
  expect(name).toHaveProperty('value', '砖世界')
  vi.mocked(api.listEntities).mockResolvedValue([match])
  fireEvent.click(screen.getByRole('button', { name: '砖世界 · 市场店' }))
  expect(await screen.findByText('已定位到现有商家“砖世界”。')).toBeTruthy()
  expect(screen.getByRole('searchbox', { name: '搜索商家' })).toHaveProperty('value', '')
  const located = await screen.findByRole('listitem')
  expect(document.activeElement).toBe(located)
  expect(confirmNavigation()).toBe(true)
  expect(confirm).toHaveBeenCalledTimes(1)
})

it('保护系统根空间和含下级空间，并显示引用冲突及确认删除结果', async () => {
  vi.mocked(api.listSpaces).mockResolvedValue([
    { id: 'house', name: '整套房屋', kind: 'house', parent_id: null },
    { id: 'room', name: '主卧', kind: 'room', parent_id: 'house' },
    { id: 'surface', name: '墙面', kind: 'surface', parent_id: 'room' },
  ])
  vi.mocked(api.deleteSpace).mockRejectedValueOnce(new Error('该空间已被正式记录使用。')).mockResolvedValueOnce(undefined)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<ArchivesView initialType="spaces" />)
  const list = await screen.findByRole('list', { name: '已有空间' })
  expect(within(list).getByText('系统根空间不可删除')).toBeTruthy()
  expect(within(list).getByText('含下级空间，无法删除')).toBeTruthy()
  const remove = within(list).getByRole('button', { name: '删除整套房屋 / 主卧 / 墙面' })
  fireEvent.click(remove)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '该空间已被正式记录使用。')
  vi.mocked(api.listSpaces).mockResolvedValue([
    { id: 'house', name: '整套房屋', kind: 'house', parent_id: null },
    { id: 'room', name: '主卧', kind: 'room', parent_id: 'house' },
  ])
  fireEvent.click(remove)
  expect(await screen.findByText('空间“墙面”已删除。')).toBeTruthy()
  expect(within(await screen.findByRole('list', { name: '已有空间' })).queryByText('整套房屋 / 主卧 / 墙面')).toBeNull()
  expect(api.deleteSpace).toHaveBeenLastCalledWith('surface')
  expect(confirm).toHaveBeenCalledTimes(2)
})
