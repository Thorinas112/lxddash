import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import Badge from '../components/Badge'

// A single point in a resource's history.
interface Point {
  t: number // epoch ms
  cpu: number // percent
  mem: number // percent
  memUsage: number // bytes
  memLimit: number // bytes
}

interface Resource {
  id: string
  name: string
  kind: 'docker' | 'lxd' | 'vm'
  status: string
  points: Point[]
}

const MAX_POINTS = 120 // 6 minutes at 3s polling

// History is seeded from the backend's 24h ring buffer; live polling
// appends on top. Cap the total so the chart stays readable.
const MAX_HISTORY_POINTS = 480 // 24h at 3s would be 28800 — downsample

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

const kindLabel: Record<string, string> = {
  docker: 'Docker',
  lxd: 'LXD',
  vm: 'VM',
}

export default function Resources() {
  const [resources, setResources] = useState<Resource[]>([])
  const prevCpu = useRef<Record<string, { usage: number; t: number; cpus: number }>>({})

  const push = useCallback((id: string, name: string, kind: Resource['kind'], status: string, cpu: number, mem: number, memUsage: number, memLimit: number) => {
    setResources((prev) => {
      const now = Date.now()
      const existing = prev.find((r) => r.id === id)
      const point: Point = { t: now, cpu, mem, memUsage, memLimit }
      if (existing) {
        return prev.map((r) =>
          r.id === id
            ? { ...r, status, points: [...r.points, point].slice(-(MAX_HISTORY_POINTS + MAX_POINTS)) }
            : r,
        )
      }
      return [...prev, { id, name, kind, status, points: [point] }]
    })
  }, [])

  // Seed the view with up to 24h of history from the backend ring
  // buffer (downsampled), then live polling appends on top.
  const seed = useCallback(async () => {
    try {
      const list = await api.resourceMetrics(24)
      setResources((prev) => {
        const next = [...prev]
        for (const r of list) {
          if (!r.samples || r.samples.length === 0) continue
          const last = r.samples[r.samples.length - 1]
          if (String(last.status).toLowerCase() !== 'running') continue
          const step = Math.max(1, Math.ceil(r.samples.length / MAX_HISTORY_POINTS))
          const points: Point[] = []
          for (let i = 0; i < r.samples.length; i += step) {
            const sm = r.samples[i]
            const memLimit = sm.mem_limit || 0
            points.push({
              t: Date.parse(sm.time),
              cpu: sm.cpu_percent || 0,
              mem: memLimit > 0 ? (sm.mem_usage / memLimit) * 100 : 0,
              memUsage: sm.mem_usage || 0,
              memLimit,
            })
          }
          const res: Resource = {
            id: r.id,
            name: r.name,
            kind: r.kind as Resource['kind'],
            status: last.status,
            points,
          }
          const idx = next.findIndex((x) => x.id === r.id)
          if (idx >= 0) next[idx] = res
          else next.push(res)
        }
        return next
      })
    } catch {
      /* ignore */
    }
  }, [])

  const remove = useCallback((id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const poll = useCallback(async () => {
    const now = Date.now()

    // Docker containers — cpu_percent already computed server-side.
    try {
      const list = await api.docker.stats()
      const seen = new Set<string>()
      for (const s of list) {
        seen.add(s.id)
        push(s.id, s.name, 'docker', 'running', s.cpu_percent || 0, s.mem_percent || 0, s.mem_usage || 0, s.mem_limit || 0)
      }
      // Remove stopped containers from the view.
      setResources((prev) => prev.filter((r) => r.kind !== 'docker' || seen.has(r.id)))
    } catch {
      /* ignore */
    }
    try {
      const list = await api.lxd.instances(true)
      const seen = new Set<string>()
      for (const inst of list) {
        seen.add(inst.name)
        if (inst.status !== 'Running') {
          remove(inst.name)
          continue
        }
        const mem = inst.state?.memory
        const memUsage = mem?.usage || 0
        const memLimit = mem?.total || 0
        const memPct = memLimit > 0 ? (memUsage / memLimit) * 100 : 0
        const cpuUsage = inst.state?.cpu?.usage || 0
        const cpus = parseInt(inst.config?.['limits.cpu'] || '1', 10) || 1
        const prev = prevCpu.current[inst.name]
        let cpuPct = 0
        if (prev && cpuUsage >= prev.usage && now > prev.t) {
          const wallDelta = (now - prev.t) / 1000 // seconds
          if (wallDelta > 0) {
            const cpuDelta = (cpuUsage - prev.usage) / 1e9 // seconds of CPU
            cpuPct = (cpuDelta / wallDelta) * 100 / cpus
          }
        }
        prevCpu.current[inst.name] = { usage: cpuUsage, t: now, cpus }
        push(inst.name, inst.name, 'lxd', inst.status, cpuPct, memPct, memUsage, memLimit)
      }
      setResources((prev) => prev.filter((r) => r.kind !== 'lxd' || seen.has(r.id)))
    } catch {
      /* ignore */
    }

    // VMs — cpu_time is cumulative ns; compute % from delta.
    try {
      const list = await api.vms.stats()
      const seen = new Set<string>()
      for (const s of list) {
        seen.add(s.uuid)
        if (s.state !== 'running') {
          remove(s.uuid)
          continue
        }
        const memPct = s.mem_percent || 0
        const cpus = s.vcpus || 1
        const prev = prevCpu.current[s.uuid]
        let cpuPct = 0
        if (prev && s.cpu_time >= prev.usage && now > prev.t) {
          const wallDelta = (now - prev.t) / 1000
          if (wallDelta > 0) {
            const cpuDelta = (s.cpu_time - prev.usage) / 1e9
            cpuPct = (cpuDelta / wallDelta) * 100 / cpus
          }
        }
        prevCpu.current[s.uuid] = { usage: s.cpu_time, t: now, cpus }
        push(s.uuid, s.name, 'vm', s.state, cpuPct, memPct, s.mem_usage || 0, s.mem_limit || 0)
      }
      setResources((prev) => prev.filter((r) => r.kind !== 'vm' || seen.has(r.id)))
    } catch {
      /* ignore */
    }
  }, [push, remove])

  useEffect(() => {
    seed()
    poll()
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [seed, poll])

  const fmtTime = (t: number) => new Date(t).toLocaleTimeString()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Resource Usage</h1>
          <p className="mt-1 text-sm text-gray-500">
            CPU and memory for every running container, instance and VM — last 24h of history
            plus live updates every 3s
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-gray-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          Live
        </span>
      </div>

      {resources.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-16 text-center text-sm text-gray-500">
          No running containers, instances or VMs to monitor.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {resources.map((r) => {
          const last = r.points[r.points.length - 1]
          const data = r.points.map((p) => ({
            time: p.t,
            cpu: Number(p.cpu.toFixed(2)),
            mem: Number(p.mem.toFixed(1)),
          }))
          return (
            <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {kindLabel[r.kind]}
                  </span>
                  <h3 className="font-medium text-gray-900">{r.name}</h3>
                  <Badge status={r.status} />
                </div>
                {last && (
                  <div className="text-right text-xs text-gray-500">
                    <div>
                      CPU <span className="font-medium tabular-nums text-gray-900">{last.cpu.toFixed(1)}%</span>
                    </div>
                    <div>
                      Mem{' '}
                      <span className="font-medium tabular-nums text-gray-900">
                        {fmtBytes(last.memUsage)}
                        {last.memLimit ? ` / ${fmtBytes(last.memLimit)}` : ''}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-gray-500">CPU %</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <AreaChart data={data}>
                      <defs>
                        <linearGradient id={`cpu-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="time" hide />
                      <YAxis width={34} stroke="#9ca3af" fontSize={10} domain={[0, 'auto']} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(l) => fmtTime(Number(l))}
                        formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'CPU']}
                      />
                      <Area
                        type="monotone"
                        dataKey="cpu"
                        stroke="#3b82f6"
                        strokeWidth={1.5}
                        fill={`url(#cpu-${r.id})`}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-gray-500">Memory %</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <AreaChart data={data}>
                      <defs>
                        <linearGradient id={`mem-${r.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="time" hide />
                      <YAxis width={34} stroke="#9ca3af" fontSize={10} domain={[0, 'auto']} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(l) => fmtTime(Number(l))}
                        formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Memory']}
                      />
                      <Area
                        type="monotone"
                        dataKey="mem"
                        stroke="#8b5cf6"
                        strokeWidth={1.5}
                        fill={`url(#mem-${r.id})`}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}