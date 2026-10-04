import { useEffect, useRef, type RefObject } from 'react'

type ModalEntry = { element: HTMLElement; close: () => void; lastFocused: HTMLElement | null }
const stack: ModalEntry[] = []
let stackRevision = 0
const background = new Map<HTMLElement, boolean>()
let previousOverflow = ''

function restoreBackground() {
  background.forEach((value, element) => { element.inert = value })
  background.clear()
}

function isolateTop() {
  restoreBackground()
  const top = stack.at(-1)?.element
  if (!top) { document.body.style.overflow = previousOverflow; return }
  // 浮层自身可能被 React 的 obscured 状态设为 inert；栈顶恢复时统一解除隔离。
  stack.forEach(entry => { entry.element.inert = entry.element !== top && !entry.element.contains(top) })
  // 从最上层浮层向外隔离兄弟节点，兼容嵌套抽屉和侧栏；菜单 portal 保留操作。
  let branch: HTMLElement = top
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || sibling.matches('.dropdown-portal, [data-modal-backdrop]')) continue
      background.set(sibling, sibling.inert)
      sibling.inert = true
    }
    if (branch.parentElement === document.body) break
    branch = branch.parentElement
  }
  document.body.style.overflow = 'hidden'
}

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  closeRef.current = onClose
  useEffect(() => {
    const element = ref.current
    if (!active || !element) { returnFocusRef.current = null; return }
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // 下层变为 inert 时 Chromium 会先把焦点移到 body，再执行上层 effect。
    const candidate = focused && focused !== document.body && focused !== document.documentElement && !element.contains(focused) ? focused : stack.at(-1)?.lastFocused ?? null
    // StrictMode 会重放 setup/cleanup；保留首次的外部打开按钮，不能改记本浮层关闭按钮。
    if (!returnFocusRef.current?.isConnected) returnFocusRef.current = candidate
    const returnFocus = returnFocusRef.current
    const entry: ModalEntry = { element, close: () => closeRef.current(), lastFocused: null }
    if (stack.length === 0) previousOverflow = document.body.style.overflow
    stack.push(entry)
    stackRevision += 1
    isolateTop()
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && element.contains(event.target)) entry.lastFocused = event.target
    }
    document.addEventListener('focusin', rememberFocus)
    const canFocus = (item: HTMLElement) => {
      if (item.tabIndex < 0 || item.closest('[inert], [hidden], [aria-hidden="true"]')) return false
      // 不把桌面隐藏的菜单或折叠内容放进 Tab 循环；jsdom 也能验证 CSS 隐藏。
      let node: HTMLElement | null = item
      while (node && node !== element.parentElement) {
        const style = window.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (node.parentElement?.tagName === 'DETAILS' && !(node.parentElement as HTMLDetailsElement).open && node.tagName !== 'SUMMARY') return false
        node = node.parentElement
      }
      return true
    }
    const items = () => {
      const list: HTMLElement[] = []
      let hasPortalItems = false
      for (const item of Array.from(element.querySelectorAll<HTMLElement>(focusableSelector)).filter(canFocus)) {
        list.push(item)
        // 多选菜单实际在 body 中：按 aria-controls 插到触发器之后，而不是页面末尾。
        const controlledId = item.getAttribute('aria-expanded') === 'true' ? item.getAttribute('aria-controls') : null
        const controlled = controlledId ? document.getElementById(controlledId) : null
        if (controlled?.matches('.dropdown-portal') && !element.contains(controlled)) {
          const menuItems = Array.from(controlled.querySelectorAll<HTMLElement>(focusableSelector)).filter(canFocus)
          list.push(...menuItems)
          hasPortalItems ||= menuItems.length > 0
        }
      }
      return { list, hasPortalItems }
    }
    ;(items().list[0] ?? element).focus()
    const keydown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== entry || event.defaultPrevented) return
      // 打开的下拉先消费 Esc；第二次 Esc 才关闭当前抽屉。
      if (event.key === 'Escape') {
        if (element.querySelector('[aria-expanded="true"]') || document.querySelector('.dropdown-portal')) return
        event.preventDefault(); entry.close(); return
      }
      if (event.key !== 'Tab') return
      const { list, hasPortalItems } = items()
      const current = document.activeElement
      if (!list.length) { event.preventDefault(); element.focus(); return }
      const index = list.indexOf(current as HTMLElement)
      if (hasPortalItems || index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === list.length - 1)) {
        const next = index < 0 ? (event.shiftKey ? list.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + list.length) % list.length
        event.preventDefault(); list[next].focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('focusin', rememberFocus)
      const index = stack.indexOf(entry)
      const wasTop = index === stack.length - 1
      if (index >= 0) stack.splice(index, 1)
      const revision = ++stackRevision
      isolateTop()
      if (wasTop && returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus()
      if (wasTop && returnFocus) requestAnimationFrame(() => {
        // 等 React 恢复 obscured/inert 后再尝试；新浮层或用户已移动焦点时不抢焦点。
        if (stackRevision !== revision || !returnFocus.isConnected || returnFocus.closest('[inert]')) return
        const top = stack.at(-1)
        if (top && !top.element.contains(returnFocus)) return
        const current = document.activeElement
        if (current && current !== document.body && current !== document.documentElement && current !== returnFocus) return
        returnFocus.focus()
      })
    }
  }, [active, ref])
}
