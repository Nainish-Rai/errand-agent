import type * as React from 'react'

/** What a span is: an agent (has its own steps), a model call or a tool call. */
export type TraceSpanKind = 'agent' | 'llm' | 'tool'

/** Hue family a span's bars are drawn in. Children inherit the nearest agent's tone. */
export type TraceTone = 'gray' | 'blue' | 'purple' | 'orange' | 'green'

/** Status of a span at a given `now`. */
export type TraceSpanStatus = 'pending' | 'running' | 'done' | 'failed'

/** One step of an agent run. Times are seconds from the start of the trace. */
export type TraceSpan = {
  id: string
  /** The span this one runs inside. Omit for the root. */
  parentId?: string
  name: string
  /** Model or tool shown after the name, e.g. "Opus 5.5" or "Notion". */
  subtitle?: string
  kind: TraceSpanKind
  /** Start, in seconds from the start of the trace. */
  start: number
  /** End, in seconds. Leave it out while the span is still open. */
  end?: number
  /** Outcome. `error` draws the span as failed (red bar, warning icon). */
  status?: 'ok' | 'error'
  /** A retried call: its bar carries a retry glyph. */
  retry?: boolean
  /** Cost in dollars. Model calls accrue it while they run; tool calls report it when done. */
  cost?: number
  tokensIn?: number
  tokensOut?: number
  input?: string
  output?: string
  /** 12px glyph for the row tile (16px in the details popover). */
  icon?: React.ReactNode
  /** Hue for an agent and its steps. @default inherited, else "gray" */
  tone?: TraceTone
}

export type TraceNode = {
  span: TraceSpan
  depth: number
  tone: TraceTone
  parent?: TraceNode
  children: TraceNode[]
}

export type TraceTree = {
  roots: TraceNode[]
  byId: Map<string, TraceNode>
  order: TraceNode[]
}

export function buildTree(spans: TraceSpan[]): TraceTree {
  const byId = new Map<string, TraceNode>()
  for (const span of spans)
    byId.set(span.id, {
      span,
      depth: 0,
      tone: span.tone ?? 'gray',
      children: [],
    })
  const roots: TraceNode[] = []
  for (const span of spans) {
    const node = byId.get(span.id)!
    const parent = span.parentId ? byId.get(span.parentId) : undefined
    if (parent) {
      node.parent = parent
      parent.children.push(node)
    } else roots.push(node)
  }
  const order: TraceNode[] = []
  const walk = (node: TraceNode, depth: number, tone: TraceTone) => {
    node.depth = depth
    node.tone = node.span.tone ?? tone
    order.push(node)
    for (const child of node.children) walk(child, depth + 1, node.tone)
  }
  for (const root of roots) walk(root, 0, root.span.tone ?? 'gray')
  return { roots, byId, order }
}

export const isFailed = (span: TraceSpan) => span.status === 'error'

export function statusAt(span: TraceSpan, now: number): TraceSpanStatus {
  if (now < span.start) return 'pending'
  if (span.end == null || now < span.end) return 'running'
  return isFailed(span) ? 'failed' : 'done'
}

/** Where the span's bar ends at `now`. */
export const endAt = (span: TraceSpan, now: number) => (span.end == null ? now : Math.min(span.end, now))
export const elapsedAt = (span: TraceSpan, now: number) => Math.max(0, endAt(span, now) - span.start)

function progressAt(span: TraceSpan, now: number) {
  if (now < span.start) return 0
  if (span.end == null) return 0
  if (span.end <= span.start) return 1
  return Math.min(1, (now - span.start) / (span.end - span.start))
}

/** Dollars spent by this span (and everything under it) at `now`; `null` when nothing reports a cost yet. */
export function costAt(node: TraceNode, now: number): number | null {
  const { span } = node
  if (now < span.start) return null
  if (span.kind === 'llm') return span.cost == null ? null : span.cost * progressAt(span, now)
  if (span.kind === 'tool') return span.cost == null || statusAt(span, now) === 'running' ? null : span.cost
  let total: number | null = null
  for (const child of node.children) {
    const c = costAt(child, now)
    if (c != null) total = (total ?? 0) + c
  }
  return total
}

export function tokensAt(span: TraceSpan, now: number) {
  if (span.kind !== 'llm') return 0
  return ((span.tokensIn ?? 0) + (span.tokensOut ?? 0)) * progressAt(span, now)
}

export type TraceTotals = {
  duration: number
  cost: number
  tokens: number
  llm: number
  tools: number
  errors: number
}

export function totalsAt(tree: TraceTree, now: number): TraceTotals {
  const t: TraceTotals = {
    duration: 0,
    cost: 0,
    tokens: 0,
    llm: 0,
    tools: 0,
    errors: 0,
  }
  let first = Infinity
  let last = -Infinity
  for (const { span } of tree.order) {
    if (now < span.start) continue
    first = Math.min(first, span.start)
    last = Math.max(last, endAt(span, now))
    if (span.kind === 'llm') {
      t.llm++
      t.cost += (span.cost ?? 0) * progressAt(span, now)
      t.tokens += tokensAt(span, now)
    }
    if (span.kind === 'tool') {
      t.tools++
      if (statusAt(span, now) !== 'running') t.cost += span.cost ?? 0
    }
    if (span.kind !== 'agent' && isFailed(span)) t.errors++
  }
  t.duration = Number.isFinite(first) ? Math.max(0, last - first) : 0
  return t
}

/** True once every span has an end at or before `now`. */
export function isComplete(spans: TraceSpan[], now: number) {
  return spans.length > 0 && spans.every((s) => s.end != null && s.end <= now)
}

export type SegmentKind = 'self' | 'tool' | 'llm' | 'failed' | 'wait'

export type Segment = {
  key: string
  kind: SegmentKind
  from: number
  to: number
  spanId: string
  retry?: boolean
}

const RANK: Record<SegmentKind, number> = {
  self: 0,
  wait: 1,
  tool: 2,
  llm: 3,
  failed: 4,
}

function childKind(span: TraceSpan): SegmentKind {
  if (span.kind === 'agent') return 'wait'
  if (isFailed(span)) return 'failed'
  return span.kind === 'llm' ? 'llm' : 'tool'
}

/**
 * An agent row's bar: its own time (light chips) cut by every child that has started. Each stretch between
 * two child boundaries is drawn by the child covering it with the highest rank (failed > model > tool > waiting).
 */
export function agentSegments(node: TraceNode, now: number): Segment[] {
  const a0 = node.span.start
  const a1 = endAt(node.span, now)
  const kids = node.children
    .filter((c) => c.span.start <= now)
    .map((c) => ({
      span: c.span,
      from: Math.max(a0, c.span.start),
      to: Math.min(a1, endAt(c.span, now)),
    }))
  const cuts = new Set<number>([a0, a1])
  for (const k of kids) {
    cuts.add(k.from)
    cuts.add(k.to)
  }
  const points = [...cuts].filter((p) => p >= a0 && p <= a1).sort((a, b) => a - b)
  if (points.length < 2) return [{ key: 'self-0', kind: 'self', from: a0, to: a0, spanId: node.span.id }]
  const out: Segment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (to <= from) continue
    let best: (typeof kids)[number] | undefined
    for (const k of kids) {
      if (k.from > from || k.to < to) continue
      if (
        !best ||
        RANK[childKind(k.span)] > RANK[childKind(best.span)] ||
        (RANK[childKind(k.span)] === RANK[childKind(best.span)] && k.span.start > best.span.start)
      )
        best = k
    }
    if (best)
      out.push({
        key: `${best.span.id}-${i}`,
        kind: childKind(best.span),
        from,
        to,
        spanId: best.span.id,
        retry: best.span.retry,
      })
    else
      out.push({
        key: `self-${i}`,
        kind: 'self',
        from,
        to,
        spanId: node.span.id,
      })
  }
  return out
}

/* Formatting, matching the reference readouts: "9.6s", "12s", "$0.12", "$0.005", "94.7k". */
export function formatDuration(seconds: number) {
  const r = Math.round(seconds * 10) / 10
  return r < 10 ? `${r.toFixed(1)}s` : `${Math.round(seconds)}s`
}
export const formatCost = (v: number) => `$${v < 0.0095 ? v.toFixed(3) : v.toFixed(2)}`
export const formatTokens = (v: number) => (v < 1000 ? `${Math.round(v)}` : `${(v / 1000).toFixed(1)}k`)

const STEPS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600]

/** At most five ticks across the visible domain. */
export function tickStep(domain: number) {
  return STEPS.find((s) => domain / s <= 5) ?? STEPS[STEPS.length - 1]
}

/** "now" rests at this fraction of the track; the domain grows past the minimum to keep it there. */
export const NOW_FRACTION = 0.644
export const MIN_DOMAIN = 9
export const domainFor = (now: number) => Math.max(MIN_DOMAIN, now / NOW_FRACTION)

/** Spans whose name or subtitle contains the query, plus their ancestors. `null` when there is no query. */
export function matchSet(tree: TraceTree, query: string, now: number): Set<string> | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const keep = new Set<string>()
  for (const node of tree.order) {
    if (now < node.span.start) continue
    const text = `${node.span.name} ${node.span.subtitle ?? ''}`.toLowerCase()
    if (!text.includes(q)) continue
    for (let n: TraceNode | undefined = node; n; n = n.parent) keep.add(n.span.id)
  }
  return keep
}
