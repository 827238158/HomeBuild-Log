import { useEffect, useId, useLayoutEffect } from 'react'

const guards = new Map<string, string>()
const defaultMessage = '当前有未保存的编辑，离开会丢失这些内容，确定继续吗？'

export function confirmNavigation(): boolean {
  const message = guards.values().next().value
  return !message || window.confirm(message)
}

export function useNavigationGuard(dirty: boolean, message = defaultMessage, navigationActive = true) {
  const id = useId()
  useLayoutEffect(() => {
    // 在导航发生前登记草稿；卸载后移除，避免旧页面阻止后续操作。
    if (dirty && navigationActive) guards.set(id, message)
    else guards.delete(id)
    return () => { guards.delete(id) }
  }, [dirty, id, message, navigationActive])
  useEffect(() => {
    if (!dirty) return
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnload)
    return () => window.removeEventListener('beforeunload', preventUnload)
  }, [dirty])
}
