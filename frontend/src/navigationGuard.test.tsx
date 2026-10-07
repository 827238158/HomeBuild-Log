import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { confirmNavigation, useNavigationGuard } from './navigationGuard'

afterEach(() => vi.restoreAllMocks())

it('确认离开后不阻拦其他页面，返回保留草稿并保护再次离开和刷新', () => {
  function Workspace() {
    const [page, setPage] = useState('录入')
    const [text, setText] = useState('')
    useNavigationGuard(Boolean(text), undefined, page === '录入')
    return <><input aria-label="草稿" value={text} onChange={event => setText(event.target.value)} />
      <span>{page}</span>{['录入', '账本', '调研'].map(next => <button key={next} onClick={() => {
        if (confirmNavigation()) setPage(next)
      }}>{next}页</button>)}</>
  }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<Workspace />)
  fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '尚未提交的输入' } })
  fireEvent.click(screen.getByText('账本页'))
  expect(screen.getByText('录入')).toBeTruthy()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByText('账本页'))
  expect(confirm).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByText('调研页'))
  expect(confirm).toHaveBeenCalledTimes(2)
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByText('录入页'))
  expect(screen.getByLabelText('草稿')).toHaveProperty('value', '尚未提交的输入')
  fireEvent.click(screen.getByText('账本页'))
  expect(confirm).toHaveBeenCalledTimes(3)
})
