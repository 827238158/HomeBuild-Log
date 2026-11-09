import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchivePicker, type ArchiveType } from './ArchiveFields'
import { createEntity, createSpace } from './domainApi'
import { HttpError } from './http'

vi.mock('./domainApi', () => ({ createEntity: vi.fn(), createSpace: vi.fn() }))

describe('档案字段', () => {
  beforeEach(() => vi.resetAllMocks())

  it.each([
    ['vendors', '交易对象', '商家'],
    ['materials', '材料', '材料'],
    ['participants', '处理人', '参与人'],
    ['spaces', '空间', '空间'],
    ['stages', '装修阶段', '装修阶段'],
  ] as const)('就地新增 %s 后自动选中并保留记录草稿', async (type: ArchiveType, label: string, archiveLabel: string) => {
    const saveRecord = vi.fn()
    const item = { id: 'new', name: '新档案', ...(type === 'spaces' ? { kind: 'room', parent_id: 'root' } : {}) }
    vi.mocked(createEntity).mockResolvedValue(item)
    vi.mocked(createSpace).mockResolvedValue({ ...item, kind: 'room', parent_id: 'root' })
    const single = type === 'vendors' || type === 'stages'
    function Form() {
      const [ids, setIds] = useState<string[]>([])
      return <form onSubmit={saveRecord}>
        <input aria-label="记录标题" defaultValue="正在录入" />
        <ArchivePicker type={type} label={label} options={type === 'spaces' ? [{ id: 'root', name: '整套房屋', kind: 'house', parent_id: null }] : []} value={single ? ids[0] ?? '' : ids} onChange={setIds} />
      </form>
    }
    render(<Form />)
    const trigger = screen.getByRole(single ? 'combobox' : 'button', { name: new RegExp('^' + label + '：') })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索' + label }), { target: { value: item.name } })
    fireEvent.click(screen.getByRole('button', { name: '新增' + archiveLabel }))
    const dialog = within(screen.getByRole('dialog'))
    expect((dialog.getByLabelText(archiveLabel + '名称') as HTMLInputElement).value).toBe(item.name)
    if (type === 'spaces') fireEvent.change(dialog.getByLabelText('上级空间'), { target: { value: 'root' } })
    fireEvent.click(dialog.getByRole('button', { name: '新增' + archiveLabel }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger.getAttribute('aria-label')).toContain(item.name)
    expect((screen.getByLabelText('记录标题') as HTMLInputElement).value).toBe('正在录入')
    expect(saveRecord).not.toHaveBeenCalled()
  })

  it('网络失败保留输入，重试撞名后可以选用服务器返回的档案', async () => {
    const onChange = vi.fn()
    vi.mocked(createEntity).mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new HttpError('重复', 409, 'archive_duplicate', { matches: [{ id: 'existing', name: '灯具店' }] }))
    render(<ArchivePicker type="vendors" label="交易对象" options={[]} value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '灯具店' } })
    fireEvent.click(screen.getByRole('button', { name: '新增商家' }))
    const dialog = within(screen.getByRole('dialog'))
    const submit = dialog.getByRole('button', { name: '新增商家' })
    fireEvent.click(submit)
    expect((await dialog.findByRole('alert')).textContent).toContain('保存档案失败')
    expect((dialog.getByLabelText('商家名称') as HTMLInputElement).value).toBe('灯具店')
    fireEvent.click(submit)
    fireEvent.click(await dialog.findByRole('button', { name: '灯具店' }))
    expect(onChange).toHaveBeenCalledWith(['existing'])
  })
})
