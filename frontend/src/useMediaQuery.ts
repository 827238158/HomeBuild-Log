import { useCallback, useMemo, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  const media = useMemo(() => window.matchMedia?.(query), [query])
  const subscribe = useCallback((notify: () => void) => {
    // 跟随 CSS 断点实时更新，让隐藏表单立即取消语音会话。
    media?.addEventListener?.('change', notify)
    return () => media?.removeEventListener?.('change', notify)
  }, [media])
  return useSyncExternalStore(subscribe, () => media?.matches ?? false, () => false)
}
