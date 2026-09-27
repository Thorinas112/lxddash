import { useCallback, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Modal from './Modal'
import Badge from './Badge'
import { api } from '../api/client'

interface Point {
  t: number
  cpu: number
  mem: number
  memUsage: number
  memLimit: number
}

const MAX_POINTS = 120
const MAX_HISTORY_POINTS = 480

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

const tooltipStyle = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#111827',
}

// LiveGraphsModal shows real-time CPU/memory charts for a single
// resource. The `sample` callback is called every 3s and must return
// { cpu, mem, memUsage, memLimit, status } or null if the resource is
// gone. When `historyId` is given, the chart is seeded with up to 24h
// of history from the backend ring buffer.
export default function LiveGraphsModal({
  title,
  kind,
  sample,
  historyId,
  onClose,
}: {
  title: string
  kind: string
  sample: () => Promise<{ cpu: number; mem: number; memUsage: number; memLimit: number; status: string } | null>
  historyId?: string
  onClose: () => void
}) {
  const [points, setPoints] = useState<Point[]>([])
  const [status, setStatus] = useState('')

  // Seed with up to 24h of history for this resource.
  useEffect(() => {
    if (!historyId) return
    let cancelled = false
    api
      .resourceMetrics(24)
      .then((list) => {
        if (cancelled) return
        const r = list.find((x: any) => x.id === historyId)
        if (!r || !r.samples || r.samples.length === 0) return
        const step = Math.max(1, Math.ceil(r.samples.length / MAX_HISTORY_POINTS))
        const pts: Point[] = []
        for (let i = 0; i < r.samples.length; i += step) {
          const sm = r.samples[i]
          const memLimit = sm.mem_limit || 0
          pts.push({
            t: Date.parse(sm.time),
            cpu: sm.cpu_percent || 0,
            mem: memLimit > 0 ? (sm.mem_usage / memLimit) * 100 : 0,
            memUsage: sm.mem_usage || 0,
            memLimit,
          })
        }
        setPoints(pts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [historyId])

  const poll = useCallback(async () => {
    const now = Date.now()
    const s = await sample()
    if (!s) return
    setStatus(s.status)
    setPoints((prev) => {
      const point: Point = { t: now, cpu: s.cpu, mem: s.mem, memUsage: s.memUsage, memLimit: s.memLimit }
      return [...prev, point].slice(-(MAX_POINTS + MAX_HISTORY_POINTS))
    })
  }, [sample])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [poll])

  const last = points[points.length - 1]
  const data = points.map((p) => ({
    time: p.t,
    cpu: Number(p.cpu.toFixed(2)),
    mem: Number(p.mem.toFixed(1)),
  }))
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString()

  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
          {kind}
        </span>
        {status && <Badge status={status} />}
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          Live · 3s
        </span>
      </div>

      {last && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-[11px] text-gray-500">CPU</div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {last.cpu.toFixed(1)}%
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-[11px] text-gray-500">Memory</div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {fmtBytes(last.memUsage)}
              {last.memLimit ? (
                <span className="text-xs font-normal text-gray-500"> / {fmtBytes(last.memLimit)}</span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {points.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-500">Collecting data…</div>
      )}

      {points.length > 0 && (
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[11px] font-medium text-gray-500">CPU %</div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="lg-cpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={10} />
                <YAxis width={34} stroke="#9ca3af" fontSize={10} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => fmtTime(Number(l))}
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'CPU']}
                />
                <Area type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} fill="url(#lg-cpu)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-gray-500">Memory %</div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="lg-mem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={10} />
                <YAxis width={34} stroke="#9ca3af" fontSize={10} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => fmtTime(Number(l))}
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Memory']}
                />
                <Area type="monotone" dataKey="mem" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#lg-mem)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Modal>
  )
}