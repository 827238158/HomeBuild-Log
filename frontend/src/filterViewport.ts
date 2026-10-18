const scrollGuards = new WeakMap<HTMLElement, () => void>()

export function preserveFilterViewport(container: HTMLElement | null, update: () => void) {
  const panel = container?.closest<HTMLElement>('.view-panel')
  if (panel && window.scrollY > 0) {
    const panelTop = panel.getBoundingClientRect().top + window.scrollY
    // 筛选可能卸载图表或缩短列表；先保住当前视口，避免页面高度骤减时滚动位置被钳到顶部。
    panel.style.minHeight = `${Math.max(0, window.scrollY + window.innerHeight - panelTop)}px`
    if (!scrollGuards.has(panel)) {
      let armed = false
      // 菜单收起与请求进入加载态会连续改动 DOM，不能在这段过渡中提前撤销占位。
      const armTimer = window.setTimeout(() => { armed = true }, 100)
      const release = () => {
        const contentBottom = panel.lastElementChild?.getBoundingClientRect().bottom ?? 0
        if (panel.isConnected && !armed && window.scrollY > 0) return
        if (panel.isConnected && window.scrollY > 0 && contentBottom < window.innerHeight) return
        panel.style.minHeight = ''
        window.clearTimeout(armTimer)
        window.removeEventListener('scroll', release)
        window.removeEventListener('resize', release)
        parentObserver.disconnect()
        scrollGuards.delete(panel)
      }
      const parentObserver = new MutationObserver(release)
      if (panel.parentElement) parentObserver.observe(panel.parentElement, { childList: true })
      window.addEventListener('scroll', release, { passive: true })
      window.addEventListener('resize', release)
      scrollGuards.set(panel, release)
    }
  }
  update()
}
