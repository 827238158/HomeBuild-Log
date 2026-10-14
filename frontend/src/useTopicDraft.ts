import { useState } from 'react'
import { useNavigationGuard } from './navigationGuard'

// 按业务对象保存主题草稿，切换页面后恢复；空数组同样代表明确移除。
export function useTopicDraft(key: string, initial: string[], busy = false) {
  const [value, setValue] = useState<string[]>(() => {
    try { const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (Array.isArray(stored) && stored.every(id => typeof id === 'string')) return stored } catch { /* 存储不可用时使用服务端归属。 */ }
    return initial
  })
  useNavigationGuard(busy || JSON.stringify(value) !== JSON.stringify(initial))
  const change = (next: string[]) => {
    setValue(next)
    try { sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* 保留本页草稿。 */ }
  }
  const clear = (next: string[] = initial) => {
    setValue(next)
    try { sessionStorage.removeItem(key) } catch { /* 本页仍清空已保存的草稿。 */ }
  }
  return { value, change, clear }
}
