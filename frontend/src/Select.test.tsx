import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

function Fixture() {
  const [first, setFirst] = useState('a')
  const [second, setSecond] = useState('x')
  return <><Select value={first} onChange={(event) => setFirst(event.target.value)}><option value="a">甲</option><option value="b">乙</option></Select><Select value={second} onChange={(event) => setSecond(event.target.value)}><option value="x">一</option><option value="y">二</option></Select></>
}

describe('Select', () => {
  it('点击标签文字不会激活隐藏代理，焦点直接给可见入口', () => {
    render(<label><span>状态</span><Select value="a" onChange={() => {}}><option value="a">待处理</option></Select></label>)
    const trigger = screen.getByRole('combobox')
    const focus = vi.spyOn(trigger, 'focus')
    expect(fireEvent.pointerDown(screen.getByText('状态'))).toBe(false)
    expect(fireEvent.click(screen.getByText('状态'))).toBe(false)
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(trigger)
    focus.mockRestore()
  })

  it('打开、选择和 Escape 恢复焦点均禁止浏览器滚动，箭头随展开改变方向', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('combobox', { name: /甲/ })
    const focus = vi.spyOn(trigger, 'focus')
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(trigger.querySelector('.dropdown-chevron')!.getAttribute('data-open')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: '乙' }))
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(trigger.querySelector('.dropdown-chevron')!.getAttribute('data-open')).toBe('false')
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    focus.mockRestore()
  })

  it('长列表仅滚动菜单内部，不调用会滚动页面祖先的 scrollIntoView', () => {
    render(<Select value="a" onChange={() => {}}><option value="a">甲</option><option value="b">乙</option></Select>)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    const menu = screen.getByRole('listbox')
    const option = screen.getByRole('option', { name: '乙' })
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 80 })
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(option, 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 240 } as DOMRect)
    const scrollIntoView = vi.fn()
    Object.defineProperty(option, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(menu.scrollTop).toBe(60)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('required 错误焦点恢复同样禁止页面移动', () => {
    render(<Select value="" required onChange={() => {}}><option value="">请选择</option></Select>)
    const trigger = screen.getByRole('combobox')
    const focus = vi.spyOn(trigger, 'focus')
    act(() => { trigger.parentElement!.querySelector('select')!.checkValidity() })
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    focus.mockRestore()
  })

  it('可见入口提供唯一 combobox，并把字段名和活动选项关联到列表', () => {
    render(<label><span>状态</span><Select value="a" onChange={() => {}}><option value="a">待处理</option><option value="b">已完成</option></Select></label>)
    const trigger = screen.getByRole('combobox', { name: '状态：待处理' })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(trigger.parentElement!.querySelector('select')!.getAttribute('aria-hidden')).toBe('true')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const menu = screen.getByRole('listbox', { name: '状态' })
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
    expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)!.textContent).toBe('待处理')
    expect(menu.querySelectorAll('button[tabindex="-1"]')).toHaveLength(2)
  })

  it('Space 打开、方向键跳过禁用项、Enter 确认，Tab 不困住焦点', () => {
    const change = vi.fn()
    render(<Select value="a" onChange={change}><option value="a">甲</option><option value="b" disabled>乙</option><option value="c">丙</option></Select>)
    const trigger = screen.getByRole('combobox')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: ' ' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)!.textContent).toBe('丙')
    expect(document.activeElement).toBe(trigger)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(change).toHaveBeenCalledWith({ target: { value: 'c' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(true)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Home 和 End 定位可用选项，Esc 只关闭当前下拉', () => {
    const ancestor = vi.fn()
    render(<div onKeyDown={ancestor}><Select value="b" onChange={() => {}}><option value="a" disabled>甲</option><option value="b">乙</option><option value="c">丙</option><option value="d" disabled>丁</option></Select></div>)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'End' })
    expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)!.textContent).toBe('丙')
    fireEvent.keyDown(trigger, { key: 'Home' })
    expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)!.textContent).toBe('乙')
    ancestor.mockClear()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(ancestor).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('required 仍由原生表单校验，错误焦点回到可见入口', () => {
    render(<form><Select value="" required onChange={() => {}}><option value="">请选择</option><option value="a">甲</option></Select></form>)
    const trigger = screen.getByRole('combobox')
    const nativeProxy = trigger.parentElement!.querySelector('select')!
    act(() => { expect(nativeProxy.checkValidity()).toBe(false) })
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-required')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('请选择一项。')
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })

  it('禁用或空选项不会打开或产生无效活动目标', () => {
    const { rerender } = render(<Select value="" disabled onChange={() => {}}>{[]}</Select>)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).toBeNull()
    rerender(<Select value="" onChange={() => {}}>{[]}</Select>)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('点击自定义触发器时阻止标签继续唤起原生选择器', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('combobox', { name: /甲/ })
    const nativeProxy = trigger.parentElement!.querySelector('select')!

    expect(fireEvent(trigger, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(fireEvent.pointerDown(nativeProxy)).toBe(false)
    expect(fireEvent.click(nativeProxy)).toBe(false)
  })

  it('同一时间只展开一个并支持外部点击关闭', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByRole('combobox', { name: /甲/ }))
    const menu = screen.getByRole('listbox')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.classList.contains('dropdown-portal')).toBe(true)
    expect(menu.style.position).toBe('fixed')
    fireEvent.click(screen.getByRole('combobox', { name: /一/ }))
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Escape 关闭并把焦点还给触发按钮', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('combobox', { name: /甲/ })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('选择选项后更新显示值', () => {
    render(<Fixture />)
    fireEvent.click(screen.getByRole('combobox', { name: /甲/ }))
    fireEvent.click(screen.getAllByRole('option', { name: '乙' }).at(-1)!)
    expect(screen.getByRole('combobox', { name: /乙/ })).toBeTruthy()
  })

  it('短显示值不改变菜单中的完整选项文案', () => {
    render(<Select value="local" displayLabel="不使用 AI" onChange={() => {}}><option value="local">不使用 AI（本地规则）</option></Select>)
    fireEvent.click(screen.getByRole('combobox', { name: '不使用 AI' }))
    expect(screen.getAllByRole('option', { name: '不使用 AI（本地规则）' })).toHaveLength(1)
  })

  it('滚动后保持展开并根据最新空间切换弹出方向', () => {
    render(<Fixture />)
    const trigger = screen.getByRole('combobox', { name: /甲/ })
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
