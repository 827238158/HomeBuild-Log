import { useEffect, useRef } from 'react'

export const IMMERSIVE_TILT_CLASS = 'immersive-tilt'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  alpha: number
}

const reduceMotionQuery = '(prefers-reduced-motion: reduce)'
const coarsePointerQuery = '(hover: none), (pointer: coarse)'

function createParticles(width: number, height: number, mobile: boolean, colors: string[]): Particle[] {
  const densityCount = Math.round((width * height) / 24_000)
  const count = mobile ? Math.min(18, Math.max(10, densityCount)) : Math.min(56, Math.max(24, densityCount))

  return Array.from({ length: count }, (_, index) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.16,
    vy: (Math.random() - 0.5) * 0.12,
    radius: 0.8 + Math.random() * 1.8,
    color: colors[index % colors.length],
    alpha: 0.16 + Math.random() * 0.28,
  }))
}

function resetTilt(element: HTMLElement | null) {
  if (!element) return
  element.style.removeProperty('--tilt-x')
  element.style.removeProperty('--tilt-y')
  element.style.removeProperty('--tilt-lift')
  element.removeAttribute('data-tilting')
}

/**
 * 工作区的氛围层：Canvas 粒子，以及通过 `.immersive-tilt` 类启用的委托式倾斜。
 * 组件不承载业务状态，可以安全地放在 `.workspace-main` 的第一个子节点。
 */
export function WorkspaceAtmosphere() {
  const layerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const layer = layerRef.current
    const canvas = canvasRef.current
    if (!layer || !canvas || typeof window === 'undefined' || typeof document === 'undefined') return
    // jsdom 不提供 Canvas 绘图上下文；组件在单元测试中保留结构即可。
    if (/jsdom/i.test(window.navigator.userAgent)) return

    const context = canvas.getContext('2d')
    if (!context) return

    const motionMedia = window.matchMedia(reduceMotionQuery)
    const coarseMedia = window.matchMedia(coarsePointerQuery)
    let particles: Particle[] = []
    let animationFrame = 0
    let pointerFrame = 0
    let width = 0
    let height = 0
    let activeTilt: HTMLElement | null = null

    const rootStyles = window.getComputedStyle(document.documentElement)
    const colors = [
      rootStyles.getPropertyValue('--primary').trim() || '#1769c2',
      rootStyles.getPropertyValue('--accent').trim() || '#a4512f',
      rootStyles.getPropertyValue('--success').trim() || '#28784c',
    ]

    const draw = () => {
      context.clearRect(0, 0, width, height)

      for (const particle of particles) {
        context.beginPath()
        context.globalAlpha = particle.alpha
        context.fillStyle = particle.color
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fill()
      }

      // 只连接附近粒子，营造轻量空间感，同时控制每帧绘制量。
      for (let first = 0; first < particles.length; first += 1) {
        for (let second = first + 1; second < particles.length; second += 1) {
          const a = particles[first]
          const b = particles[second]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distanceSquared = dx * dx + dy * dy
          if (distanceSquared > 13_500) continue

          context.beginPath()
          context.globalAlpha = (1 - distanceSquared / 13_500) * 0.08
          context.strokeStyle = colors[first % colors.length]
          context.lineWidth = 0.7
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.stroke()
        }
      }
      context.globalAlpha = 1
    }

    const animate = () => {
      if (document.hidden || motionMedia.matches) {
        animationFrame = 0
        draw()
        return
      }

      for (const particle of particles) {
        particle.x += particle.vx
        particle.y += particle.vy
        if (particle.x < -8) particle.x = width + 8
        if (particle.x > width + 8) particle.x = -8
        if (particle.y < -8) particle.y = height + 8
        if (particle.y > height + 8) particle.y = -8
      }
      draw()
      animationFrame = window.requestAnimationFrame(animate)
    }

    const startAnimation = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      if (motionMedia.matches || document.hidden) {
        draw()
        return
      }
      animationFrame = window.requestAnimationFrame(animate)
    }

    const resize = () => {
      const bounds = layer.getBoundingClientRect()
      width = Math.max(1, Math.round(bounds.width))
      height = Math.max(1, Math.round(bounds.height))
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      particles = createParticles(width, height, coarseMedia.matches, colors)
      startAnimation()
    }

    const schedulePointerUpdate = (event: PointerEvent) => {
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame)
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = 0
        const target = event.target instanceof Element ? event.target : null
        const insideContent = target?.closest('.workspace-content')
        const blocksTilt = target?.closest('input, textarea, select, [role="dialog"], .select-menu, .multi-select-options, .source-picker__menu')
        const allowPointerEffects = !coarseMedia.matches && !motionMedia.matches && insideContent && !blocksTilt

        const nextTilt = allowPointerEffects ? target?.closest<HTMLElement>(`.${IMMERSIVE_TILT_CLASS}`) ?? null : null
        if (activeTilt !== nextTilt) resetTilt(activeTilt)
        activeTilt = nextTilt
        if (!activeTilt) return

        const rect = activeTilt.getBoundingClientRect()
        const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2))
        const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2))
        activeTilt.style.setProperty('--tilt-x', `${(-y * 3.5).toFixed(2)}deg`)
        activeTilt.style.setProperty('--tilt-y', `${(x * 3.5).toFixed(2)}deg`)
        activeTilt.style.setProperty('--tilt-lift', '-3px')
        activeTilt.setAttribute('data-tilting', '')
      })
    }

    const clearPointerEffects = () => {
      resetTilt(activeTilt)
      activeTilt = null
    }

    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) clearPointerEffects()
    }

    const handlePreferenceChange = () => {
      clearPointerEffects()
      resize()
    }
    const handleVisibilityChange = () => startAnimation()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)

    resizeObserver?.observe(layer)
    window.addEventListener('resize', resize, { passive: true })
    window.addEventListener('pointermove', schedulePointerUpdate, { passive: true })
    window.addEventListener('pointerout', handlePointerOut, { passive: true })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    motionMedia.addEventListener?.('change', handlePreferenceChange)
    coarseMedia.addEventListener?.('change', handlePreferenceChange)
    resize()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame)
      resizeObserver?.disconnect()
      resetTilt(activeTilt)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', schedulePointerUpdate)
      window.removeEventListener('pointerout', handlePointerOut)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      motionMedia.removeEventListener?.('change', handlePreferenceChange)
      coarseMedia.removeEventListener?.('change', handlePreferenceChange)
    }
  }, [])

  return (
    <div ref={layerRef} className="workspace-atmosphere" aria-hidden="true">
      <canvas ref={canvasRef} className="workspace-atmosphere__particles" />
    </div>
  )
}

