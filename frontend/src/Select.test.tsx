import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

function Fixture() {
  const [first, setFirst] = useState('a')
  const [second, setSecond] = useState('x')
  return <><Select value={first} onChange={(event) => setFirst(event.target.value)}><option value="a">甲</option><option value="b">乙</option></Select><Select value={second} onChange={(event) => setSecond(event.target.value)}><option value="x">一</option><option value="y">二</option></Select></>
}

describe('Select', () => {
  it('点击自定义触发器时阻止标签继续唤起原生选择器', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('button', { name: /甲/ })
    const nativeProxy = screen.getAllByRole('combobox')[0]

    expect(fireEvent(trigger, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(fireEvent.pointerDown(nativeProxy)).toBe(false)
    expect(fireEvent.click(nativeProxy)).toBe(false)
  })

  it('同一时间只展开一个并支持外部点击关闭', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByRole('button', { name: /甲/ }))
    const menu = screen.getByRole('listbox')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.classList.contains('dropdown-portal')).toBe(true)
    expect(menu.style.position).toBe('fixed')
    fireEvent.click(screen.getByRole('button', { name: /一/ }))
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape 关闭并把焦点还给触发按钮', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('button', { name: /甲/ })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('选择选项后更新显示值', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByRole('button', { name: /甲/ }))
    fireEvent.click(screen.getAllByRole('option', { name: '乙' }).at(-1)!)
    expect(screen.getByRole('button', { name: /乙/ })).toBeTruthy()
  })

  it('滚动后保持展开并根据最新空间切换弹出方向', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('button', { name: /甲/ })
    let rect = { left: 20, top: 750, right: 220, bottom: 792, width: 200, height: 42, x: 20, y: 750, toJSON: () => ({}) }
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect)
    fireEvent.click(trigger)
    const menu = screen.getByRole('listbox')
    expect(menu.style.bottom).not.toBe('auto')

    rect = { ...rect, top: 100, bottom: 142, y: 100 }
    fireEvent.scroll(document)
    expect(screen.getByRole('listbox')).toBe(menu)
    expect(menu.style.top).toBe('148px')
    expect(menu.style.bottom).toBe('auto')
  })
})
