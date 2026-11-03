import * as React from 'react'
import {
  IconAlertTriangleFilled,
  IconChevronDown,
  IconCornerDownRight,
  IconHierarchy,
  IconRotate,
  IconRotateClockwise,
  IconSearch,
  IconSearchOff,
  IconX,
} from '@tabler/icons-react'
import { cva } from 'class-variance-authority'
import { motion as limeMotion } from '@errand/design-tokens'
import { motion, useReducedMotion } from 'motion/react'
import { TextMorph } from 'torph/react'

import { useControllableState } from '@/components/agents/hooks/use-controllable-state'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/agents/ui/badge'
import { Button } from '@/components/agents/ui/button'
import { Kbd, KbdGroup } from '@/components/agents/ui/kbd'
import { NativeSelect, NativeSelectOption } from '@/components/agents/ui/native-select'
import { Popover, PopoverContent, PopoverTitle } from '@/components/agents/ui/popover'
import { Spinner } from '@/components/agents/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/agents/ui/tooltip'

import {
  agentSegments,
  buildTree,
  costAt,
  domainFor,
  elapsedAt,
  endAt,
  formatCost,
  formatDuration,
  formatTokens,
  isComplete,
  matchSet,
  statusAt,
  tickStep,
  totalsAt,
  type Segment,
  type TraceNode,
  type TraceSpan,
  type TraceSpanKind,
  type TraceSpanStatus,
  type TraceTone,
  type TraceTotals,
  type TraceTree,
} from './trace-model'

export type { TraceSpan, TraceSpanKind, TraceSpanStatus, TraceTone }

/*
 * Measured from the reference (607px wide, light | dark):
 * - Card: 1px border, 14px radius, card fill. Header 57px (12/16px padding, 16px gap), 191x32 search field
 *   (10px radius, foreground 3% | 4.5% fill, 10% hairline). KPI strip: six 100x68 cells on a 1px border-coloured grid.
 * - Chart: 36px axis row, rows 36px, list capped at 448px and pinned to the newest row. The Steps column is half the
 *   width; the track reserves 1px on the left. "now" rests at 64.4% of the track (domain >= 9s) and ticks step
 *   1/2/5/10/15/20/30/60s so at most five show.
 * - Bars: 20px (agents, 6px radius) or 16px (steps, 5px radius), 2px shorter than their span, at least 4px.
 *   Each hue is a base colour (model calls) mixed 50% (tool calls) and 24% (an agent's own time) into the card.
 *   Waiting is a -45deg hatch of foreground 22% with a 1px inset ring.
 * - Errand motion (Lime, design-system-v3.html): rows arrive over --dur-base on --ease-out (grid rows 0 -> 1fr,
 *   opacity, y -8px); settling cross-fades the spinner out over --dur-fast; a failure turns the name to the danger
 *   text over --dur-fast. KPI digits morph over --dur-base; handoff connectors fade in over --dur-base. The running-bar
 *   sweep, the name shimmer, the failure shake and the blur on arrival are gone: the spinner is the only loop.
 *   Every duration is a token, so reduced motion zeroes it.
 * - Errand colour: no hue in the operator console. Bars are ink steps (model calls --fg-3, tool calls and an agent's
 *   own time mixed into the surface) and waiting is a dashed outline instead of a hatch.
 */

const STYLES = `
[data-slot=trace-waterfall] {
  /* Errand: hues come from the token palette, so both themes and the gallery agree. */
  --trace-gray: var(--fg-3);
  --trace-blue: var(--fg-3);
  --trace-purple: var(--fg-3);
  --trace-orange: var(--fg-3);
  --trace-green: var(--fg-3);
}
@keyframes trace-replay { from { rotate: 0deg } to { rotate: -360deg } }
`

const ROW = 36
const EASE_ROW = 'ease-out'
const EASE_OUT = 'ease-out'
/** KPI readouts tick at most this often and show a value this long after taking it. */
const KPI_INTERVAL = 750
const KPI_LEAD = 80

const TONE: Record<TraceTone, string> = {
  gray: '[--hue:var(--trace-gray)]',
  blue: '[--hue:var(--trace-blue)]',
  purple: '[--hue:var(--trace-purple)]',
  orange: '[--hue:var(--trace-orange)]',
  green: '[--hue:var(--trace-green)]',
}

const HATCH = 'border border-dashed border-fg-3 bg-transparent'

/** One bar piece. `kind` picks the fill from the row's hue; `size` is agent (20px) or step (16px). */
const traceBarVariants = cva('absolute flex items-center justify-center overflow-hidden text-fg-inverse', {
  variants: {
    kind: {
      self: 'bg-[color-mix(in_oklab,var(--hue)_24%,var(--surface))]',
      tool: 'bg-[color-mix(in_oklab,var(--hue)_50%,var(--surface))]',
      llm: 'bg-(--hue)',
      failed: 'bg-danger',
      wait: HATCH,
    },
    size: {
      agent: 'top-2 h-5 rounded-sm',
      step: 'top-2.5 h-4 rounded-sm',
    },
  },
  defaultVariants: { kind: 'llm', size: 'step' },
})

type BarKind = Segment['kind']

function leafKind(span: TraceSpan): BarKind {
  if (span.status === 'error') return 'failed'
  return span.kind === 'tool' ? 'tool' : 'llm'
}

/* ---------------------------------------------------------------------------------------------- hooks */

/**
 * Lets one readout's text through at most every `KPI_INTERVAL` ms, so a morphing number stays legible. Each
 * readout keeps its own rhythm, and like the reference it shows a value `KPI_LEAD` ms after taking it.
 */
function useThrottledText(value: string, immediate: boolean): string {
  const [shown, setShown] = React.useState(value)
  const state = React.useRef({
    latest: value,
    last: -Infinity,
    timer: null as ReturnType<typeof setTimeout> | null,
  })
  React.useEffect(() => {
    const s = state.current
    s.latest = value
    if (immediate) {
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
      return
    }
    if (s.timer || value === shown) return
    const t = performance.now()
    s.timer = setTimeout(
      () => {
        s.last = performance.now()
        const taken = s.latest
        s.timer = setTimeout(() => {
          s.timer = null
          setShown(taken)
        }, KPI_LEAD)
      },
      Math.max(0, s.last + KPI_INTERVAL - t),
    )
  }, [value, immediate, shown])
  React.useEffect(() => {
    const s = state.current
    return () => void (s.timer && clearTimeout(s.timer))
  }, [])
  return immediate ? value : shown
}

/* ---------------------------------------------------------------------------------------------- root */

type TraceWaterfallProps = Omit<React.ComponentProps<'div'>, 'children' | 'title'> & {
  /** Every span of the run. Rows appear as `now` reaches their start. */
  spans: TraceSpan[]
  /** Current trace time in seconds. Spans past it are not drawn yet; running ones end at it. */
  now: number
  /** Heading in the top-left. @default "Trace" */
  title?: React.ReactNode
  /** Whether playback is running (drives the pause / play button). @default true until the run completes */
  playing?: boolean
  onPlayingChange?: (playing: boolean) => void
  /** Called by the replay button (and by play once the run has finished). */
  onReplay?: () => void
  /** Playback rate shown in the footer select. */
  speed?: number
  defaultSpeed?: number
  onSpeedChange?: (speed: number) => void
  /** Choices for the speed select. @default [0.5, 1, 1.5, 2, 4] */
  speeds?: number[]
  /** Search text that filters the rows. */
  query?: string
  defaultQuery?: string
  onQueryChange?: (query: string) => void
}

/** A live waterfall of an agent run: KPIs, a searchable tree of steps and a time axis that keeps "now" in view. */
function TraceWaterfall({
  spans,
  now,
  title = 'Trace',
  playing: playingProp,
  onPlayingChange,
  onReplay,
  speed: speedProp,
  defaultSpeed = 1,
  onSpeedChange,
  speeds = [0.5, 1, 1.5, 2, 4],
  query: queryProp,
  defaultQuery = '',
  onQueryChange,
  className,
  style,
  ...props
}: TraceWaterfallProps) {
  const reduced = useReducedMotion() ?? false
  const tree = React.useMemo(() => buildTree(spans), [spans])
  const complete = isComplete(spans, now)
  const playing = playingProp ?? !complete
  const [speed, setSpeed] = useControllableState({
    value: speedProp,
    defaultValue: defaultSpeed,
    onChange: onSpeedChange,
  })
  const [query, setQuery] = useControllableState({
    value: queryProp,
    defaultValue: defaultQuery,
    onChange: onQueryChange,
  })
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const [open, setOpen] = React.useState<{ id: string; anchor: Anchor } | null>(null)
  const [split, setSplit] = React.useState(0.5)
  const [width, setWidth] = React.useState(605)
  const bodyRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const totals = totalsAt(tree, now)

  const toggle = React.useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div
      data-slot="trace-waterfall"
      data-state={complete ? 'complete' : playing ? 'playing' : 'paused'}
      className={cn(
        '@container/trace w-full max-w-[46rem] overflow-hidden rounded-panel border bg-surface text-sm text-fg',
        className,
      )}
      style={style}
      {...props}
    >
      <style href="agents-ui-trace-waterfall" precedence="default">
        {STYLES}
      </style>
      <TraceHeader title={title} query={query} onQueryChange={setQuery} />
      <TraceKpis totals={totals} immediate={reduced || complete} />
      <div ref={bodyRef}>
        <TraceChart
          tree={tree}
          now={now}
          width={width}
          split={split}
          onSplitChange={setSplit}
          query={query}
          collapsed={collapsed}
          onToggle={toggle}
          openId={open?.id ?? null}
          onOpenSpan={(id, anchor) => setOpen({ id, anchor })}
          complete={complete}
          reduced={reduced}
        />
      </div>
      <TraceFooter
        playing={playing && !complete}
        complete={complete}
        onPlayPause={() => (complete ? onReplay?.() : onPlayingChange?.(!playing))}
        onReplay={onReplay}
        speed={speed}
        speeds={speeds}
        onSpeedChange={setSpeed}
      />
      <TraceSpanPopover
        node={open ? (tree.byId.get(open.id) ?? null) : null}
        anchor={open?.anchor ?? null}
        now={now}
        onClose={() => setOpen(null)}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- header */

function TraceHeader({
  title,
  query,
  onQueryChange,
}: {
  title: React.ReactNode
  query: string
  onQueryChange: (q: string) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && inputRef.current) {
        const root = inputRef.current.closest('[data-slot=trace-waterfall]')
        const r = root?.getBoundingClientRect()
        if (!r || r.bottom < 0 || r.top > window.innerHeight) return
        event.preventDefault()
        inputRef.current.focus()
        inputRef.current.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div data-slot="trace-waterfall-header" className="flex items-center gap-4 border-b px-4 py-3">
      <span className="font-semibold">{title}</span>
      <label
        data-slot="trace-waterfall-search"
        data-focus-shell
        className={cn(
          'ms-auto flex h-8 w-[191px] min-w-0 cursor-text items-center gap-2 rounded-field border border-line-strong bg-field ps-2.5 pe-1.5 text-fg-3',
          'transition-[border-color] duration-(--dur-instant) ease-out focus-within:border-control',
          EASE_OUT,
        )}
      >
        <IconSearch aria-hidden className="size-4 shrink-0" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search"
          spellCheck={false}
          autoComplete="off"
          aria-label="Search steps"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onQueryChange('')
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-3 [&::-webkit-search-cancel-button]:appearance-none"
        />
        <KbdGroup>
          <Kbd size="md" className="min-w-7 font-mono">
            {query ? 'Esc' : '⌘F'}
          </Kbd>
        </KbdGroup>
      </label>
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- KPIs */

const MORPH = { duration: limeMotion.base, ease: `cubic-bezier(${limeMotion.easeOut.join(', ')})` }

function TraceKpis({ totals, immediate }: { totals: TraceTotals; immediate: boolean }) {
  const items: [string, string][] = [
    ['Duration', formatDuration(totals.duration)],
    // The total reads "$0.00" before anything is spent; row labels keep "$0.000".
    ['Cost', totals.cost > 0 ? formatCost(totals.cost) : '$0.00'],
    ['Tokens', formatTokens(totals.tokens)],
    ['LLM calls', String(totals.llm)],
    ['Tool calls', String(totals.tools)],
    ['Errors', String(totals.errors)],
  ]
  return (
    <dl data-slot="trace-waterfall-kpis" className="grid grid-cols-3 gap-px bg-line pb-px @lg/trace:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1 bg-surface p-3">
          <dt className="truncate text-xs text-fg-3">{label}</dt>
          <dd className="text-lg/6 tabular-nums" aria-live={label === 'Errors' ? 'polite' : undefined}>
            <KpiValue value={value} immediate={immediate} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function KpiValue({ value, immediate }: { value: string; immediate: boolean }) {
  return <TextMorph {...MORPH}>{useThrottledText(value, immediate)}</TextMorph>
}

/* ---------------------------------------------------------------------------------------------- chart */

type Anchor = { getBoundingClientRect: () => DOMRect }

type ChartProps = {
  tree: TraceTree
  now: number
  width: number
  split: number
  onSplitChange: (split: number) => void
  query: string
  collapsed: Set<string>
  onToggle: (id: string) => void
  openId: string | null
  onOpenSpan: (id: string, anchor: Anchor) => void
  complete: boolean
  reduced: boolean
}

type Geometry = Record<string, { top: number; height: number }>

type Scale = {
  label: number
  track: number
  px: number
  x: (t: number) => number
}

function TraceChart({
  tree,
  now,
  width,
  split,
  onSplitChange,
  query,
  collapsed,
  onToggle,
  openId,
  onOpenSpan,
  complete,
  reduced,
}: ChartProps) {
  const label = Math.floor(width * split)
  const track = Math.max(1, width - label - 1)
  const domain = domainFor(now)
  const px = track / domain
  const scale: Scale = { label, track, px, x: (t: number) => 1 + t * px }
  const step = tickStep(domain)
  const ticks: number[] = []
  for (let t = 0; t * px < track; t += step) ticks.push(Math.round(t * 100) / 100)

  const matches = matchSet(tree, query, now)
  const empty = matches != null && matches.size === 0

  // Slowest finished step (any kind but agents).
  let slowest: TraceNode | null = null
  let finished = 0
  for (const node of tree.order) {
    if (node.span.kind === 'agent') continue
    const st = statusAt(node.span, now)
    if (st !== 'done' && st !== 'failed') continue
    finished++
    if (!slowest || elapsedAt(node.span, now) > elapsedAt(slowest.span, now)) slowest = node
  }
  if (finished < 4) slowest = null

  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const thumbRef = React.useRef<HTMLDivElement>(null)
  const badgeRef = React.useRef<HTMLDivElement>(null)
  const refs = React.useRef({
    li: new Map<string, HTMLElement>(),
    row: new Map<string, HTMLElement>(),
    label: new Map<string, HTMLElement>(),
  })
  const follow = React.useRef(true)
  const pinned = React.useRef(-1)
  const [geometry, setGeometry] = React.useState<Geometry>({})
  const [scrollUi, setScrollUi] = React.useState(false)
  const badge = React.useRef({
    id: '',
    x: 0,
    y: 0,
    glideUntil: 0,
    shown: false,
  })
  const slowestId = slowest?.span.id ?? ''
  const kick = React.useRef<() => void>(() => {})
  // Rows already present on the first render skip the enter motion.
  const [initialIds] = React.useState(
    () => new Set(tree.order.filter((n) => n.span.start <= now).map((n) => n.span.id)),
  )

  // One measuring loop: pins the list to the newest row, flags stuck agent rows, places the Slowest badge and
  // the connectors, and sizes the overlay scrollbar. It idles once nothing has moved for a while.
  React.useEffect(() => {
    let raf = 0
    let idle = 0
    let lastGeo = ''
    let lastTime = performance.now()
    const tick = () => {
      raf = 0
      const scroller = scrollerRef.current
      const content = contentRef.current
      if (!scroller || !content) return
      const t = performance.now()
      const dt = Math.min(64, t - lastTime)
      lastTime = t
      let moved = false
      if (follow.current) {
        const max = scroller.scrollHeight - scroller.clientHeight
        if (max - scroller.scrollTop > 0.5) {
          scroller.scrollTop = max
          pinned.current = scroller.scrollTop
          moved = true
        }
      }
      const base = content.getBoundingClientRect().top
      const geo: Geometry = {}
      for (const [id, li] of refs.current.li) {
        const r = li.getBoundingClientRect()
        geo[id] = {
          top: Math.round((r.top - base) * 2) / 2,
          height: Math.round(r.height * 2) / 2,
        }
        const row = refs.current.row.get(id)
        if (row && row.dataset.sticky != null) {
          const stuck = row.getBoundingClientRect().top - r.top > 0.5
          if (stuck !== (row.dataset.stuck != null)) {
            if (stuck) row.dataset.stuck = ''
            else delete row.dataset.stuck
          }
        }
      }
      const key = JSON.stringify(geo)
      if (key !== lastGeo) {
        lastGeo = key
        moved = true
        setGeometry(geo)
      }
      // Slowest badge: follows its label, gliding when the slowest step changes.
      const b = badge.current
      const el = badgeRef.current
      const labelEl = b.id ? refs.current.label.get(b.id) : undefined
      const g = b.id ? geo[b.id] : undefined
      if (el) {
        if (labelEl && g && g.height > ROW / 2) {
          const lr = labelEl.getBoundingClientRect()
          const cr = content.getBoundingClientRect()
          const tx = lr.right - cr.left + 8
          const ty = g.top + 8
          if (!b.shown || reduced) {
            b.x = tx
            b.y = ty
          } else if (t < b.glideUntil) {
            const k = 1 - Math.exp(-dt / 70)
            b.x += (tx - b.x) * k
            b.y += (ty - b.y) * k
            moved = true
          } else {
            b.x = tx
            b.y = ty
          }
          el.style.transform = `translate(${b.x}px, ${b.y}px)`
          el.style.opacity = '1'
          b.shown = true
        } else {
          el.style.opacity = '0'
        }
      }
      // Overlay scrollbar.
      const thumb = thumbRef.current
      if (thumb) {
        const ratio = scroller.clientHeight / Math.max(1, scroller.scrollHeight)
        const h = Math.max(24, ratio * (scroller.clientHeight - 4))
        const travel = scroller.clientHeight - 4 - h
        const max = scroller.scrollHeight - scroller.clientHeight
        thumb.style.height = `${h}px`
        thumb.style.transform = `translateY(${max > 0 ? (scroller.scrollTop / max) * travel : 0}px)`
        thumb.parentElement!.dataset.overflow = ratio < 0.999 ? 'true' : 'false'
      }
      idle = moved ? 0 : idle + 1
      if (idle < 40) raf = requestAnimationFrame(tick)
    }
    kick.current = () => {
      idle = 0
      if (!raf) raf = requestAnimationFrame(tick)
    }
    kick.current()
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  // Any render may move things: restart the loop.
  React.useLayoutEffect(() => {
    const b = badge.current
    if (b.id !== slowestId) {
      if (b.id && slowestId) b.glideUntil = performance.now() + 450
      b.id = slowestId
    }
    kick.current()
  })

  const scrollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const onUserScroll = () => {
    const s = scrollerRef.current
    if (!s) return
    if (Math.abs(s.scrollTop - pinned.current) < 1) return
    // Programmatic pinning lands here too, so only re-arm following; user intent (wheel, keys, touch) disarms it.
    if (s.scrollHeight - s.clientHeight - s.scrollTop < 2) follow.current = true
    setScrollUi(true)
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => setScrollUi(false), 900)
    kick.current()
  }

  const register = React.useCallback((kind: 'li' | 'row' | 'label', id: string, el: HTMLElement | null) => {
    const map = refs.current[kind]
    if (el) map.set(id, el)
    else map.delete(id)
  }, [])

  const visible = (node: TraceNode) => matches == null || matches.has(node.span.id)

  const ctx: RowContext = {
    now,
    scale,
    query: query.trim(),
    collapsed,
    onToggle,
    openId,
    onOpenSpan,
    register,
    visible,
    reduced,
    initial: initialIds,
  }

  // Handoff connectors: from the parent's bar down to each sub-agent's row, at its start and (once done) its end.
  const connectors: React.ReactNode[] = []
  for (const node of tree.order) {
    const parent = node.parent
    if (node.span.kind !== 'agent' || !parent || now < node.span.start) continue
    const pg = geometry[parent.span.id]
    const cg = geometry[node.span.id]
    if (!pg || !cg || cg.height < ROW / 2 || !visible(node) || collapsed.has(parent.span.id)) continue
    const y1 = pg.top + 28
    const y2 = cg.top + ROW / 2
    const tone = TONE[node.tone]
    const xs = label + scale.x(node.span.start)
    connectors.push(
      <Connector key={`${node.span.id}-in`} toneClass={tone} x={xs} y1={y1} y2={y2} dir={1} reduced={reduced} />,
    )
    const st = statusAt(node.span, now)
    if (st === 'done' || st === 'failed') {
      const xe = label + scale.x(endAt(node.span, now)) - 2
      connectors.push(
        <Connector
          key={`${node.span.id}-out`}
          toneClass={tone}
          x={xe}
          y1={y1}
          y2={y2}
          dir={-1}
          reduced={reduced}
          returning
        />,
      )
    }
  }

  return (
    <div data-slot="trace-waterfall-chart" className="relative">
      {/* Gridlines */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 transition-opacity duration-(--dur-base) ease-out',
          empty && 'opacity-0',
        )}
        style={{ left: label }}
      >
        <div className="absolute inset-y-0 right-0 left-px overflow-hidden">
          <Gridlines ticks={ticks} px={px} />
        </div>
      </div>
      {/* Now marker */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-20 overflow-hidden"
        style={{ left: label }}
      >
        <span
          data-slot="trace-waterfall-now"
          className={cn(
            'absolute inset-y-0 w-px bg-fg/70 transition-opacity duration-(--dur-base) ease-out',
            (complete || empty) && 'opacity-0',
          )}
          style={{ left: scale.x(now) }}
        >
          <span className="absolute top-8 -left-[3.5px] size-2 rounded-full bg-fg ring-2 ring-surface" />
        </span>
      </div>
      {/* Axis */}
      <Collapse open={!empty}>
        <div className="flex h-9">
          <span
            data-slot="trace-waterfall-label"
            className="flex shrink-0 items-center gap-1.5 ps-4 text-xs text-fg-3"
            style={{ width: label }}
          >
            <IconHierarchy aria-hidden className="size-3.5" />
            Steps
          </span>
          <span className="relative flex-1">
            <span className="absolute inset-0 overflow-hidden">
              {ticks.map((t) => (
                <span
                  key={t}
                  className={cn(
                    'absolute top-2.5 ps-2 text-xs whitespace-nowrap text-fg-3 tabular-nums',
                    'transition-opacity duration-(--dur-fast) ease-out starting:opacity-0',
                  )}
                  style={{ left: t * px }}
                >
                  {t}s
                </span>
              ))}
            </span>
          </span>
        </div>
      </Collapse>
      {/* Rows */}
      <div
        data-slot="trace-waterfall-scroll-area"
        role="presentation"
        className="group/scroll relative"
        onPointerEnter={() => kick.current()}
      >
        <div
          ref={scrollerRef}
          role="presentation"
          onScroll={onUserScroll}
          onWheel={(event) => {
            if (event.deltaY < 0) follow.current = false
          }}
          onTouchMove={() => (follow.current = false)}
          onKeyDown={(event) => {
            if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) follow.current = false
          }}
          className="max-h-[448px] overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div ref={contentRef} className="relative">
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
              {connectors}
            </svg>
            <div
              ref={badgeRef}
              aria-hidden={!slowest}
              className="pointer-events-none absolute top-0 left-0 z-[5] opacity-0 transition-opacity duration-(--dur-base) ease-out"
            >
              <Badge variant="warning" className="h-5 gap-1 px-1.5 text-xs">
                Slowest
              </Badge>
            </div>
            <ul role="tree" aria-label="Steps">
              {tree.roots.map((root) => (
                <TraceRow key={root.span.id} node={root} ctx={ctx} />
              ))}
            </ul>
            <Collapse open={empty} className="data-[state=closed]:translate-y-1">
              <div role="status" className="flex flex-col items-center gap-1 px-6 py-10 text-center">
                <span className="mb-2 flex size-9 items-center justify-center rounded-md border bg-surface text-fg-3">
                  <IconSearchOff aria-hidden className="size-4" />
                </span>
                <span>No matching steps</span>
                <span className="text-fg-3">Nothing in this trace matches “{query}”</span>
              </div>
            </Collapse>
          </div>
        </div>
        <div
          data-slot="trace-waterfall-scrollbar"
          aria-hidden
          data-overflow="false"
          className={cn(
            'pointer-events-none absolute inset-y-0.5 right-0.5 w-1.5 opacity-0 transition-opacity duration-(--dur-base) ease-out',
            'data-[overflow=true]:group-hover/scroll:opacity-100',
            scrollUi && 'data-[overflow=true]:opacity-100',
          )}
        >
          <div ref={thumbRef} data-slot="trace-waterfall-thumb" className="w-1.5 rounded-full bg-fg/25" />
        </div>
      </div>
      <SplitHandle label={label} width={width} split={split} onSplitChange={onSplitChange} />
    </div>
  )
}

function Gridlines({ ticks, px }: { ticks: number[]; px: number }) {
  return ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: t * px }} />)
}

/** Grid-rows collapsible used for rows, groups, the axis and the empty state (400ms, blur 2px, y -8px). */
function Collapse({ open, className, children, ...props }: React.ComponentProps<'div'> & { open: boolean }) {
  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity,translate] duration-(--dur-base)',
        EASE_ROW,
        'data-[state=closed]:grid-rows-[0fr] data-[state=closed]:opacity-0',
        className,
      )}
      inert={!open || undefined}
      {...props}
    >
      <div className="min-h-0 overflow-clip">{children}</div>
    </div>
  )
}

function Connector({
  x,
  y1,
  y2,
  dir,
  toneClass,
  returning = false,
  reduced,
}: {
  x: number
  y1: number
  y2: number
  dir: 1 | -1
  toneClass: string
  returning?: boolean
  reduced: boolean
}) {
  const r = 6
  const d = returning
    ? `M ${x - r} ${y2} Q ${x} ${y2} ${x} ${y2 - r} L ${x} ${y1}`
    : `M ${x} ${y1} L ${x} ${y2 - r} Q ${x} ${y2} ${x + r * dir} ${y2}`
  // Errand: the connector fades in on --ease-out instead of drawing, and its dot arrives without a pop.
  const seconds = (ms: number) => (reduced ? 0 : ms / 1000)
  return (
    <g className={toneClass}>
      <motion.path
        d={d}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        className="stroke-(--hue)"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: seconds(limeMotion.base), ease: [...limeMotion.easeOut] }}
      />
      <motion.circle
        cx={x}
        cy={y1}
        r={3.5}
        className="fill-(--hue) stroke-surface"
        strokeWidth={1}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: seconds(limeMotion.base), ease: [...limeMotion.easeOut] }}
      />
    </g>
  )
}

function SplitHandle({
  label,
  width,
  split,
  onSplitChange,
}: {
  label: number
  width: number
  split: number
  onSplitChange: (s: number) => void
}) {
  const clamp = (v: number) => Math.min(0.7, Math.max(0.3, v))
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize steps column"
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      className="absolute inset-y-0 z-30 w-3 cursor-col-resize touch-none outline-none focus-visible:bg-ring/20"
      style={{ left: label - 6 }}
      onPointerDown={(event) => {
        const startX = event.clientX
        const start = split
        const el = event.currentTarget
        el.setPointerCapture(event.pointerId)
        const move = (e: PointerEvent) => onSplitChange(clamp(start + (e.clientX - startX) / width))
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onSplitChange(clamp(split - 0.02))
        if (event.key === 'ArrowRight') onSplitChange(clamp(split + 0.02))
      }}
    />
  )
}

/* ---------------------------------------------------------------------------------------------- rows */

type RowContext = {
  now: number
  scale: Scale
  query: string
  collapsed: Set<string>
  onToggle: (id: string) => void
  openId: string | null
  onOpenSpan: (id: string, anchor: Anchor) => void
  register: (kind: 'li' | 'row' | 'label', id: string, el: HTMLElement | null) => void
  visible: (node: TraceNode) => boolean
  reduced: boolean
  /** Rows already there on first render: they skip the enter animation. */
  initial: Set<string>
}

function TraceRow({ node, ctx }: { node: TraceNode; ctx: RowContext }) {
  const { span, depth } = node
  const { now, scale, collapsed, onToggle, openId, register } = ctx
  const isAgent = span.kind === 'agent' && node.children.length > 0
  const open = !collapsed.has(span.id)
  const shown = ctx.visible(node)
  const status = statusAt(span, now)
  const kids = node.children.filter((c) => now >= c.span.start)

  return (
    <li
      ref={(el) => register('li', span.id, el)}
      role="treeitem"
      aria-expanded={isAgent ? open : undefined}
      aria-selected={openId === span.id}
      data-hidden={shown ? undefined : ''}
      inert={!shown || undefined}
      className={cn(
        'group/li grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-(--dur-base)',
        EASE_ROW,
        !ctx.initial.has(span.id) && 'starting:grid-rows-[0fr] starting:opacity-0',
        'data-hidden:grid-rows-[0fr] data-hidden:opacity-0',
      )}
    >
      <div className="min-h-0 overflow-clip">
        <div
          ref={(el) => register('row', span.id, el)}
          data-slot="trace-row"
          data-status={status}
          data-kind={span.kind}
          data-active={openId === span.id ? '' : undefined}
          data-sticky={isAgent ? '' : undefined}
          className={cn(
            'group/row relative flex h-9',
            'transition-[translate,background-color] duration-(--dur-base)',
            EASE_ROW,
            !ctx.initial.has(span.id) && 'starting:-translate-y-2',
            'group-data-hidden/li:-translate-y-2',
            'hover:bg-fg/5',
            isAgent && [
              'sticky data-stuck:border-b data-stuck:border-line data-stuck:bg-surface',
              'data-stuck:hover:bg-[color-mix(in_oklab,var(--fg)_5%,var(--surface))]',
            ],
            TONE[node.tone],
          )}
          style={isAgent ? { top: depth * ROW, zIndex: 10 - depth } : undefined}
        >
          {isAgent && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 opacity-0 group-data-stuck/row:opacity-100"
              style={{ left: scale.label }}
            >
              <div className="absolute inset-y-0 right-0 left-px overflow-hidden">
                <Gridlines ticks={ticksFor(scale)} px={scale.px} />
              </div>
            </div>
          )}
          <RowLabel node={node} ctx={ctx} isAgent={isAgent} open={open} onToggle={() => onToggle(span.id)} />
          <div data-slot="trace-timeline" className="relative flex-1">
            <div className="absolute inset-0 overflow-hidden">
              <RowBars node={node} ctx={ctx} isAgent={isAgent} />
            </div>
          </div>
        </div>
        {kids.length > 0 && (
          <Collapse open={open} className={cn('relative', !open && '-translate-y-2')}>
            <ul role="group" className="relative">
              <span aria-hidden className="absolute top-0 bottom-3 w-px bg-line" style={{ left: 18 + depth * 20 }} />
              {kids.map((child) => (
                <TraceRow key={child.span.id} node={child} ctx={ctx} />
              ))}
            </ul>
          </Collapse>
        )}
      </div>
    </li>
  )
}

function ticksFor(scale: Scale) {
  const domain = scale.track / scale.px
  const step = tickStep(domain)
  const out: number[] = []
  for (let t = 0; t * scale.px < scale.track; t += step) out.push(Math.round(t * 100) / 100)
  return out
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return text
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-accent-wash text-inherit">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  )
}

function RowLabel({
  node,
  ctx,
  isAgent,
  open,
  onToggle,
}: {
  node: TraceNode
  ctx: RowContext
  isAgent: boolean
  open: boolean
  onToggle: () => void
}) {
  const { span, depth } = node
  const status = statusAt(span, ctx.now)
  // Agents carry their activity in the bar; only steps show a spinner beside their name.
  const running = status === 'running' && span.kind !== 'agent'
  const failed = status === 'failed'
  return (
    <div
      className={cn('relative flex shrink-0 items-center gap-2 pe-3', isAgent && 'cursor-pointer')}
      style={{
        width: ctx.scale.label,
        paddingInlineStart: (isAgent ? 10 : 16) + depth * 20,
      }}
      onClick={isAgent ? onToggle : undefined}
    >
      {isAgent && (
        <button
          type="button"
          aria-label={open ? `Collapse ${span.name}` : `Expand ${span.name}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          className="relative flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-3 outline-none hover:bg-surface-2 hover:text-fg"
        >
          <IconChevronDown
            aria-hidden
            className={cn(
              'size-3.5 transition-transform duration-(--dur-fast) ease-out',
              EASE_OUT,
              !open && '-rotate-90',
            )}
          />
        </button>
      )}
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-sm border bg-surface [&_svg]:size-3">
        {span.icon}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5" aria-live={running ? undefined : 'polite'}>
          <StatusSlot status={span.kind === 'agent' && status === 'running' ? 'done' : status} />
          <span
            className={cn(
              'grid min-w-0 transition-colors duration-(--dur-fast) ease-out',
              EASE_OUT,
              failed && 'text-danger-text',
            )}
          >
            <span className={cn('truncate', isAgent && 'font-semibold')}>
              <Highlight text={span.name} query={ctx.query} />
            </span>
          </span>
        </span>
        {span.subtitle && (
          <span className="min-w-0 truncate text-fg-3">
            <Highlight text={span.subtitle} query={ctx.query} />
          </span>
        )}
      </span>
    </div>
  )
}

/** Spinner while running, a warning when failed, nothing when done. */
function StatusSlot({ status }: { status: TraceSpanStatus }) {
  const running = status === 'running'
  const failed = status === 'failed'
  const shown = running || failed
  // Keep the spinner mounted only while it is visible or leaving, so settled rows do not keep spinning.
  const [spinner, setSpinner] = React.useState(running)
  if (running && !spinner) setSpinner(true)
  React.useEffect(() => {
    if (running) return
    const id = setTimeout(() => setSpinner(false), 320)
    return () => clearTimeout(id)
  }, [running])
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 transition-[width,margin,opacity] duration-(--dur-fast)',
        EASE_OUT,
        shown ? 'w-3.5 opacity-100' : '-me-1.5 w-0 opacity-0',
      )}
    >
      {spinner && (
        <Spinner
          dynamic={false}
          aria-hidden
          className={cn(
            'col-start-1 row-start-1 size-3.5 text-fg-3',
            'transition-[opacity,scale] duration-(--dur-fast) ease-out',
            EASE_OUT,
            running ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      <IconAlertTriangleFilled
        className={cn(
          'col-start-1 row-start-1 size-3.5 text-danger-text',
          'transition-[opacity,scale] duration-(--dur-fast) ease-out',
          EASE_OUT,
          failed ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  )
}

function BarGlyph({ kind, retry, width }: { kind: BarKind; retry?: boolean; width: number }) {
  if (width < 14) return null
  if (kind === 'failed') return <IconX aria-hidden className="relative size-3" strokeWidth={2.5} />
  if (retry) return <IconRotateClockwise aria-hidden className="relative size-3" strokeWidth={2.5} />
  return null
}

function RowBars({ node, ctx, isAgent }: { node: TraceNode; ctx: RowContext; isAgent: boolean }) {
  const { span } = node
  const { now, scale, onOpenSpan, register } = ctx
  const status = statusAt(span, now)
  const running = status === 'running'
  const end = endAt(span, now)
  const barW = (from: number, to: number) => Math.max(4, (to - from) * scale.px - 2)

  const open = (id: string, el: HTMLElement, clientX: number, barEl?: HTMLElement) => {
    const bar = barEl ?? (el.nextElementSibling as HTMLElement | null) ?? el
    const r0 = el.getBoundingClientRect()
    const offset = clientX > 0 ? clientX - r0.left : r0.width / 2
    onOpenSpan(id, {
      getBoundingClientRect: () => {
        const r = bar.getBoundingClientRect()
        return new DOMRect(r.left + Math.min(offset, r.width), r.top, 0, r.height)
      },
    })
  }

  const cost = costAt(node, now)
  const labelText = `${formatDuration(elapsedAt(span, now))}${cost != null ? ` · ${formatCost(cost)}` : ''}`

  const trigger = (id: string, left: number, width: number, name: string) => (
    <button
      type="button"
      aria-label={`Details for ${name}`}
      aria-haspopup="dialog"
      onClick={(event) => open(id, event.currentTarget, event.clientX)}
      className="absolute top-1 z-[1] h-7 rounded-md outline-none"
      style={{ left, width }}
    />
  )

  let bars: React.ReactNode
  if (isAgent) {
    const segments = agentSegments(node, now)
    bars = (
      <>
        {segments.map((seg) => {
          const left = scale.x(seg.from)
          const width = barW(seg.from, seg.to)
          const clickable = seg.kind === 'llm' || seg.kind === 'tool' || seg.kind === 'failed'
          const childName = node.children.find((c) => c.span.id === seg.spanId)?.span.name ?? span.name
          return (
            <React.Fragment key={seg.key}>
              {clickable && trigger(seg.spanId, left, width, childName)}
              <span
                data-kind={seg.kind}
                className={cn(traceBarVariants({ kind: seg.kind, size: 'agent' }), 'pointer-events-none')}
                style={{ left, width }}
              >
                <BarGlyph kind={seg.kind} retry={seg.retry} width={width} />
              </span>
            </React.Fragment>
          )
        })}
        <button
          type="button"
          aria-label={`Details for ${span.name}`}
          aria-haspopup="dialog"
          onClick={(event) => open(span.id, event.currentTarget, event.clientX, event.currentTarget)}
          className="absolute top-1 h-7 rounded-md outline-none"
          style={{
            left: scale.x(span.start),
            width: Math.max(4, (end - span.start) * scale.px),
          }}
        />
      </>
    )
  } else {
    const kind = leafKind(span)
    const left = scale.x(span.start)
    const width = barW(span.start, end)
    bars = (
      <>
        {trigger(span.id, left, width, span.name)}
        <span
          data-kind={kind}
          className={cn(traceBarVariants({ kind, size: 'step' }), 'pointer-events-none')}
          style={{ left, width }}
        >
          <BarGlyph kind={kind} retry={span.retry} width={width} />
        </span>
      </>
    )
  }

  const labelLeft = isAgent ? scale.x(end) : scale.x(span.start) + barW(span.start, end)
  return (
    <>
      {bars}
      <span
        className={cn(
          'pointer-events-none absolute top-2.5 flex items-center gap-2 ps-2 text-xs whitespace-nowrap text-fg-3 tabular-nums',
        )}
        style={{ left: labelLeft }}
      >
        <span
          ref={(el) => register('label', span.id, el)}
          className="transition-opacity duration-(--dur-base) ease-out starting:opacity-0"
        >
          {labelText}
        </span>
      </span>
    </>
  )
}

/* ---------------------------------------------------------------------------------------------- footer */

const PAUSE_PATHS = ['M6.5 5.5 L9.5 5.5 L9.5 18.5 L6.5 18.5 Z', 'M14.5 5.5 L17.5 5.5 L17.5 18.5 L14.5 18.5 Z']
const PLAY_PATHS = ['M7.5 4.5 L13 8.25 L13 15.75 L7.5 19.5 Z', 'M13 8.25 L18.5 12 L18.5 12 L13 15.75 Z']

function PlayPauseIcon({ playing }: { playing: boolean }) {
  const paths = playing ? PAUSE_PATHS : PLAY_PATHS
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor" strokeLinejoin="round">
      {paths.map((d, i) => (
        <path
          key={i}
          style={{ d: `path("${d}")` } as React.CSSProperties}
          stroke="currentColor"
          strokeWidth={1}
          className={cn('transition-[d] duration-(--dur-base)', EASE_OUT)}
        />
      ))}
    </svg>
  )
}

function TraceFooter({
  playing,
  complete,
  onPlayPause,
  onReplay,
  speed,
  speeds,
  onSpeedChange,
}: {
  playing: boolean
  complete: boolean
  onPlayPause: () => void
  onReplay?: () => void
  speed: number
  speeds: number[]
  onSpeedChange: (speed: number) => void
}) {
  const [spin, setSpin] = React.useState(0)
  const playLabel = playing ? 'Pause' : complete ? 'Replay' : 'Play'
  return (
    <div data-slot="trace-waterfall-footer" className="flex min-h-[49px] items-center gap-2 border-t px-3 py-2">
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" rounded aria-label={playLabel} onClick={onPlayPause} />}
        >
          <PlayPauseIcon playing={playing} />
        </TooltipTrigger>
        <TooltipContent>{playLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-md"
              aria-label="Replay"
              onClick={() => {
                setSpin((n) => n + 1)
                onReplay?.()
              }}
            />
          }
        >
          <span
            key={spin}
            data-slot="trace-replay-icon"
            className={cn(
              'flex',
              spin > 0 && 'animate-[trace-replay_var(--dur-slow)_var(--ease-out)]',
            )}
          >
            <IconRotate aria-hidden className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Replay</TooltipContent>
      </Tooltip>
      <NativeSelect
        size="sm"
        aria-label="Playback speed"
        value={String(speed)}
        onValueChange={(v) => onSpeedChange(Number(v))}
        wrapperClassName="w-[71px]"
        className="border-line ps-2.5 pe-8 text-sm"
      >
        {speeds.map((s) => (
          <NativeSelectOption key={s} value={String(s)}>
            {s}x
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <TraceLegend className="ms-auto hidden @[34rem]/trace:flex" />
    </div>
  )
}

/** Key for the bar fills: model call, tool call, waiting, handoff and failed. */
function TraceLegend({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="trace-waterfall-legend"
      className={cn('flex h-8 items-center gap-4 text-xs text-fg-3 [--hue:var(--trace-gray)]', className)}
      {...props}
    >
      <li className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-(--hue)" />
        Model call
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm bg-[color-mix(in_oklab,var(--hue)_50%,var(--surface))]" />
        Tool call
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn('h-2.5 w-4 rounded-sm', HATCH)} />
        Waiting
      </li>
      <li className="flex items-center gap-1.5">
        <IconCornerDownRight aria-hidden className="size-3.5" />
        Handoff
      </li>
      <li className="flex items-center gap-1.5">
        <span className="flex h-2.5 w-4 items-center justify-center rounded-sm bg-danger text-on-danger">
          <IconX aria-hidden className="size-2.5" strokeWidth={3} />
        </span>
        Failed
      </li>
    </ul>
  )
}

/* ---------------------------------------------------------------------------------------------- popover */

const STATUS_BADGE: Record<
  TraceSpanStatus,
  { label: string; variant: 'success' | 'info' | 'destructive' | 'secondary' }
> = {
  pending: { label: 'Queued', variant: 'secondary' },
  running: { label: 'Running', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}

function TraceSpanPopover({
  node,
  anchor,
  now,
  onClose,
}: {
  node: TraceNode | null
  anchor: Anchor | null
  now: number
  onClose: () => void
}) {
  // Keep the last span on screen while the popover animates closed.
  const [shown, setShown] = React.useState<{ node: TraceNode; anchor: Anchor } | null>(null)
  if (node && anchor && (shown?.node !== node || shown.anchor !== anchor)) setShown({ node, anchor })
  if (!shown) return null
  const { span } = shown.node
  const status = statusAt(span, now)
  const badge = STATUS_BADGE[status]
  const cost = costAt(shown.node, now)
  let tokensIn = span.tokensIn
  let tokensOut = span.tokensOut
  if (span.kind === 'agent') {
    let a = 0
    let b = 0
    const walk = (n: TraceNode) => {
      if (n.span.kind === 'llm' && n.span.start <= now) {
        const p = n.span.end == null ? 0 : Math.min(1, (now - n.span.start) / Math.max(1e-6, n.span.end - n.span.start))
        a += (n.span.tokensIn ?? 0) * p
        b += (n.span.tokensOut ?? 0) * p
      }
      n.children.forEach(walk)
    }
    walk(shown.node)
    tokensIn = a || undefined
    tokensOut = b || undefined
  } else if (span.kind === 'llm' && span.end != null && now < span.end) {
    const p = Math.max(0, (now - span.start) / Math.max(1e-6, span.end - span.start))
    tokensIn = tokensIn != null ? tokensIn * p : undefined
    tokensOut = tokensOut != null ? tokensOut * p : undefined
  }
  const stats: [string, string][] = [
    ['Duration', formatDuration(elapsedAt(span, now))],
    ['Started', `+${formatDuration(span.start)}`],
  ]
  if (cost != null) stats.push(['Cost', formatCost(cost)])
  if (tokensIn != null) stats.push(['Tokens in', formatTokens(tokensIn)])
  if (tokensOut != null) stats.push(['Tokens out', formatTokens(tokensOut)])

  return (
    <Popover open={node != null} onOpenChange={(o) => !o && onClose()}>
      <PopoverContent
        anchor={shown.anchor}
        align="start"
        alignOffset={-11}
        showArrow={false}
        data-status={status}
        className="gap-3 p-3.5"
      >
        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-surface [&_svg]:size-4">
            {span.icon}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <PopoverTitle render={<h2 />} className="truncate text-sm font-semibold">
              {span.name}
            </PopoverTitle>
            <Badge variant={badge.variant} className="h-5 px-1.5 text-xs">
              <TextMorph {...MORPH}>{badge.label}</TextMorph>
            </Badge>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-3 outline-none transition-[color,background-color,scale] duration-(--dur-instant) ease-out hover:bg-surface-3 hover:text-fg active:scale-(--scale-press)"
          >
            <IconX aria-hidden className="size-4" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <dl className="grid grid-cols-3 gap-3 rounded-md bg-surface-2 p-3">
          {stats.map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col gap-0.5">
              <dt className="truncate text-xs text-fg-3">{k}</dt>
              <dd className="tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {span.input && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-fg-3">Input</span>
            <p>{span.input}</p>
          </div>
        )}
        {span.output && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-fg-3">Output</span>
            <p>{span.output}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { TraceLegend, TraceWaterfall, traceBarVariants }
export type { TraceWaterfallProps }
