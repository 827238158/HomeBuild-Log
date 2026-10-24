import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

afterEach(() => vi.unstubAllGlobals())

it('订阅断点变化，切换查询和卸载时清理原监听', () => {
  const narrow = Object.assign(new EventTarget(), { matches: false })
  const wide = Object.assign(new EventTarget(), { matches: true })
  const removeNarrow = vi.spyOn(narrow, 'removeEventListener')
  const removeWide = vi.spyOn(wide, 'removeEventListener')
  vi.stubGlobal('matchMedia', vi.fn(query => query === '(max-width: 760px)' ? narrow : wide))
  const { result, rerender, unmount } = renderHook(({ query }) => useMediaQuery(query), { initialProps: { query: '(max-width: 760px)' } })
  expect(result.current).toBe(false)
  act(() => { narrow.matches = true; narrow.dispatchEvent(new Event('change')) })
  expect(result.current).toBe(true)
  rerender({ query: '(max-width: 1100px)' })
  expect(removeNarrow).toHaveBeenCalledWith('change', expect.any(Function))
  act(() => { wide.matches = false; wide.dispatchEvent(new Event('change')) })
  expect(result.current).toBe(false)
  unmount()
  expect(removeWide).toHaveBeenCalledWith('change', expect.any(Function))
})
