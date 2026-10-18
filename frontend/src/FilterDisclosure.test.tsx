import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FilterDisclosure } from './FilterDisclosure'
import { Select } from './Select'

function Fixture() {
  const [text, setText] = useState('')
  return <FilterDisclosure title="测试页面" activeCount={Number(Boolean(text))} onClear={() => setText('')}>
    <input aria-label="关键词" value={text} onChange={event => setText(event.target.value)} />
    <Select aria-label="状态" value="a" onChange={() => {}}><option value="a">待处理</option><option value="b">已完成</option></Select>
  </FilterDisclosure>
}

describe('FilterDisclosure', () => {
  it('默认从可访问顺序隐藏条件，重新展开保留同一输入与草稿', () => {
    render(<Fixture />)
    const toggle = screen.getByRole('button', { name: '筛选' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(toggle)
    const input = screen.getByRole('textbox', { name: '关键词' })
    fireEvent.change(input, { target: { value: '保留草稿' } })
    fireEvent.click(toggle)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('textbox')).toBe(input)
    expect(input).toHaveProperty('value', '保留草稿')
  })

  it('收起时关闭Portal菜单；Escape先关闭下拉，再收起面板', () => {
    render(<Fixture />)
    const toggle = screen.getByRole('button', { name: '筛选' })
    fireEvent.click(toggle)
    const select = screen.getByRole('combobox')
    fireEvent.click(select)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(toggle)
    fireEvent.click(toggle)
    fireEvent.click(select)
    fireEvent.keyDown(select, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(select, { key: 'Escape' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  it('收起后可清除条件，清除按钮消失前无滚动地恢复到筛选入口', () => {
    render(<Fixture />)
    const toggle = screen.getByRole('button', { name: '筛选' })
    fireEvent.click(toggle)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '条件' } })
    fireEvent.click(toggle)
    const clear = screen.getByRole('button', { name: '清除筛选' })
    clear.focus()
    const focus = vi.spyOn(toggle, 'focus')
    fireEvent.click(clear)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(toggle)
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('textbox')).toHaveProperty('value', '')
    focus.mockRestore()
  })
})
