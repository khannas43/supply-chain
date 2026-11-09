import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'

export interface Theme {
  text: string
  muted: string
  grid: string
  surface: string
  accent: string
  series: string[]
  sev: Record<'critical' | 'high' | 'medium' | 'low', string>
  ok: string
  warn: string
  bad: string
}

// Colours come from the page's own tokens so charts follow light and dark mode.
export function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback
  return {
    text: v('--text', '#1c2430'), muted: v('--muted', '#5f6b7a'), grid: v('--border', '#e3e7ed'), surface: v('--surface', '#fff'),
    accent: v('--accent', '#1f5fbf'),
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#eda100', '#e87ba4'],
    sev: { critical: v('--crit', '#7a1fa2'), high: v('--bad', '#b3261e'), medium: v('--warn', '#9a6200'), low: v('--muted', '#8a94a3') },
    ok: v('--ok', '#1b7f4b'), warn: v('--warn', '#9a6200'), bad: v('--bad', '#b3261e'),
  }
}

const AXIS = (t: Theme) => ({ axisLine: { lineStyle: { color: t.grid } }, axisTick: { show: false }, axisLabel: { color: t.muted } })
export const axisStyle = AXIS

// A chart that sizes itself, rebuilds when data or colour scheme changes, and carries a text description.
export function Chart({ build, height = 240, label }: { build: (t: Theme) => echarts.EChartsOption; height?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scheme, setScheme] = useState(0)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setScheme((n) => n + 1)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const t = readTheme()
    chart.setOption({ textStyle: { color: t.text }, aria: { enabled: true }, animationDuration: 400, ...build(t) })
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [build, scheme])

  return <div ref={ref} style={{ height }} role="img" aria-label={label} />
}
