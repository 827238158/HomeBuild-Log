import { act, fireEvent, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { StrictMode, useLayoutEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModalFocus } from './useModalFocus'

function Modal({ name, onClose, children }: { name: string; onClose: () => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useModalFocus(ref, true, onClose)
  return createPortal(<><button data-modal-backdrop tabIndex={-1}>遮罩{name}</button><aside ref={ref} role="dialog" aria-label={name} tabIndex={-1}><button>关闭{name}</button>{children}<button>末项{name}</button></aside></>, document.body)
}

function NestedFixture() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  return <><button onClick={() => setOuter(true)}>打开外层</button>{outer && <Modal name="外层" onClose={() => setOuter(false)}><button onClick={() => setInner(true)}>打开内层</button>{inner && <Modal name="内层" onClose={() => setInner(false)} />}</Modal>}</>
}

afterEach(() => { document.body.style.overflow = ''; vi.restoreAllMocks() })

describe('useModalFocus', () => {
  it('嵌套浮层只关闭最上层，逐层恢复焦点和原始 overflow', () => {
    document.body.style.overflow = 'scroll'
    render(<NestedFixture />)
    const trigger = screen.getByRole('button', { name: '打开外层' })
    trigger.focus(); fireEvent.click(trigger)
    expect(document.activeElement?.textContent).toBe('关闭外层')
    expect(document.body.style.overflow).toBe('hidden')
    const innerTrigger = screen.getByRole('button', { name: '打开内层' })
    innerTrigger.focus(); fireEvent.click(innerTrigger)
    expect(document.activeElement?.textContent).toBe('关闭内层')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '内层' })).toBeNull()
    expect(document.activeElement).toBe(innerTrigger)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('Tab 和 Shift+Tab 保持焦点在当前浮层，隐藏原生代理不会进入循环', () => {
    render(<Modal name="测试" onClose={() => {}}><select aria-hidden="true" tabIndex={-1}><option>代理</option></select><button hidden>隐藏项</button></Modal>)
    const first = screen.getByRole('button', { name: '关闭测试' })
    const last = screen.getByRole('button', { name: '末项测试' })
    last.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last)
  })

  it('下拉 portal 和指定遮罩不被背景隔离，打开下拉时 Esc 不关浮层', () => {
    const close = vi.fn()
    const menu = document.createElement('div'); menu.className = 'dropdown-portal'; document.body.append(menu)
    const { unmount } = render(<Modal name="测试" onClose={close} />)
    expect(menu.inert).not.toBe(true)
    expect((screen.getByText('遮罩测试') as HTMLElement).inert).not.toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).not.toHaveBeenCalled()
    menu.remove(); fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('卸载恢复原有背景 inert 状态', () => {
    const background = document.createElement('section'); background.inert = true; document.body.append(background)
    const ordinary = document.createElement('section'); ordinary.inert = false; document.body.append(ordinary)
    const { unmount } = render(<Modal name="测试" onClose={() => {}} />)
    expect(ordinary.inert).toBe(true)
    unmount(); expect(ordinary.inert).toBe(false); expect(background.inert).toBe(true)
    background.remove(); ordinary.remove()
  })

  it('CSS 隐藏和显式负 tabindex 不会成为循环尾端', () => {
    render(<Modal name="测试" onClose={() => {}}><button style={{ display: 'none' }}>CSS 隐藏</button><button tabIndex={-1}>程序入口</button><details><summary>摘要</summary><button>折叠内容</button></details></Modal>)
    const first = screen.getByRole('button', { name: '关闭测试' })
    screen.getByRole('button', { name: '末项测试' }).style.display = 'none'
    first.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('摘要')
  })

  it('关联 body portal 多选项按触发器位置进入 Tab 顺序', () => {
    function Fixture() {
      return <Modal name="多选" onClose={() => {}}><button aria-expanded="true" aria-controls="test-multi-portal">选择空间</button>{createPortal(<div id="test-multi-portal" className="dropdown-portal"><input type="checkbox" aria-label="客厅" /><input type="checkbox" aria-label="卧室" /></div>, document.body)}<button>下一字段</button></Modal>
    }
    render(<StrictMode><Fixture /></StrictMode>)
    const trigger = screen.getByRole('button', { name: '选择空间' })
    const first = screen.getByRole('checkbox', { name: '客厅' })
    const second = screen.getByRole('checkbox', { name: '卧室' })
    trigger.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(second)
    fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(screen.getByRole('button', { name: '下一字段' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(second)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(trigger)
  })

  it('下层 inert 在上层 effect 前导致 body 焦点时，仍记得真实打开按钮', () => {
    function BlurBeforeModalEffects({ onClose }: { onClose: () => void }) {
      // jsdom 不模拟 inert 自动失焦，显式重现 Chromium 在提交阶段的行为。
      useLayoutEffect(() => { (document.activeElement as HTMLElement)?.blur() }, [])
      return <Modal name="内层" onClose={onClose} />
    }
    function Fixture() {
      const [inner, setInner] = useState(false)
      return <Modal name="外层" onClose={() => {}}><button onClick={() => setInner(true)}>记录按钮</button>{inner && <BlurBeforeModalEffects onClose={() => setInner(false)} />}</Modal>
    }
    render(<StrictMode><Fixture /></StrictMode>)
    const opener = screen.getByRole('button', { name: '记录按钮' })
    opener.focus(); fireEvent.click(opener)
    expect(document.activeElement?.textContent).toBe('关闭内层')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
  })

  it('延后一帧恢复焦点不会抢夺随后新浮层的焦点', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
    render(<NestedFixture />)
    const outer = screen.getByRole('button', { name: '打开外层' })
    outer.focus(); fireEvent.click(outer)
    const opener = screen.getByRole('button', { name: '打开内层' })
    opener.focus(); fireEvent.click(opener); fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(opener)
    act(() => { frames.forEach(frame => frame(0)) })
    expect(document.activeElement?.textContent).toBe('关闭内层')
  })

  it('StrictMode 重放后仍逐层归还外部打开按钮，不记录自身关闭按钮', () => {
    render(<StrictMode><NestedFixture /></StrictMode>)
    const trigger = screen.getByRole('button', { name: '打开外层' })
    trigger.focus(); fireEvent.click(trigger)
    const opener = screen.getByRole('button', { name: '打开内层' })
    opener.focus(); fireEvent.click(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })
})
