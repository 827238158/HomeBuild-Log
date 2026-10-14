import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RecordConflict, conflictRecord } from './RecordConflict'
import { HttpError } from './http'
import type { ProjectionRecord } from './domainApi'
afterEach(cleanup)
it('逐项选择前禁止应用，不自动保存且保留所选内容和最新版本', () => {
  const latest = { id:'r', title:'手机修改', description:'手机说明', version:3 } as ProjectionRecord
  const resolve=vi.fn()
  render(<RecordConflict latest={latest} draft={{ title:'电脑修改', description:'电脑说明' }} onResolve={resolve} onCancel={vi.fn()} />)
  expect(screen.getByRole('button',{name:'应用选择并继续编辑'})).toHaveProperty('disabled',true)
  fireEvent.click(screen.getByLabelText('保留我的修改：电脑修改'))
  expect(screen.getByRole('button',{name:'应用选择并继续编辑'})).toHaveProperty('disabled',true)
  fireEvent.click(screen.getByLabelText('采用最新内容：手机说明'))
  fireEvent.click(screen.getByRole('button',{name:'应用选择并继续编辑'}))
  expect(resolve).toHaveBeenCalledWith({title:'电脑修改',description:'手机说明'},3)
})
it('仅识别结构化记录冲突，普通业务409不被误判', () => {
  const latest={id:'r',version:2} as ProjectionRecord
  expect(conflictRecord(new HttpError('冲突',409,'record_version_conflict',{latest_record:latest}))).toBe(latest)
  expect(conflictRecord(new HttpError('其他冲突',409,'HTTP_409'))).toBeNull()
})
