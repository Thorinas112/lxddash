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
import { api } from '../api/client'

interface Sample {
  time: string
  cpu_percent: number
  mem_used: number
  mem_total: number
  mem_percent: number
  disk_used: number
  disk_total: number
  net_rx: number
  net_tx: number
  net_ifaces?: { name: string; rx: number; tx: number }[]
  gpus?: { name: string; util_percent: number; mem_used: number; mem_total: number; temp_c: number }[]
}

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

export default function Metrics() {
  const [hours, setHours] = useState(1)
  const [data, setData] = useState<Sample[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api.metrics(hours))
    } catch (e: any) {
      setError(e.message)
    }
  }, [hours])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  const fmtTime = (t: string) => new Date(t).toLocaleTimeString()

  // Compute per-interface throughput (bytes/sec) from counter deltas.
  const ifaceNames = Array.from(
    new Set(data.flatMap((d) => (d.net_ifaces || []).map((i) => i.name)))
  )
  const ifaceSeries = ifaceNames.map((name) => {
    const points = data.map((d, idx) => {
      const prev = data[idx - 1]
      const cur = (d.net_ifaces || []).find((i) => i.name === name)
      if (!cur || !prev) return { time: d.time, rx: 0, tx: 0 }
      const p = (prev.net_ifaces || []).find((i) => i.name === name)
      if (!p) return { time: d.time, rx: 0, tx: 0 }
      const dt = (new Date(d.time).getTime() - new Date(prev.time).getTime()) / 1000
      if (dt <= 0) return { time: d.time, rx: 0, tx: 0 }
      return {
        time: d.time,
        rx: Math.max(0, (cur.rx - p.rx) / dt),
        tx: Math.max(0, (cur.tx - p.tx) / dt),
      }
    })
    return { name, points }
  })

  // Per-GPU series: utilization %, memory used, temperature.
  const gpuNames = Array.from(new Set(data.flatMap((d) => (d.gpus || []).map((g) => g.name))))
  const gpuSeries = gpuNames.map((name) => {
    const points = data.map((d) => {
      const g = (d.gpus || []).find((x) => x.name === name)
      return {
        time: d.time,
        util: g?.util_percent ?? 0,
        memUsed: g?.mem_used ?? 0,
        memTotal: g?.mem_total ?? 0,
        memPct: g && g.mem_total > 0 ? (g.mem_used / g.mem_total) * 100 : 0,
        temp: g?.temp_c ?? 0,
      }
    })
    return { name, points }
  })

  // Total network throughput (bytes/sec) from cumulative counter deltas.
  const netSeries = data.map((d, idx) => {
    const prev = data[idx - 1]
    if (!prev) return { time: d.time, rx: 0, tx: 0 }
    const dt = (new Date(d.time).getTime() - new Date(prev.time).getTime()) / 1000
    if (dt <= 0) return { time: d.time, rx: 0, tx: 0 }
    return {
      time: d.time,
      rx: Math.max(0, (d.net_rx - prev.net_rx) / dt),
      tx: Math.max(0, (d.net_tx - prev.net_tx) / dt),
    }
  })

  const last = data[data.length - 1]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Resource Graphs</h1>
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          {[1, 6, 24].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`rounded px-3 py-1 text-sm ${
                hours === h ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {data.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          Collecting metrics… check back in a minute (samples are taken every 10s)
        </div>
      )}

      {data.length > 0 && (
        <div className="space-y-6">
          {/* Main host charts — uniform 2x2 grid */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">CPU Usage</h3>
                <span className="text-xs tabular-nums text-gray-500">
                  {last?.cpu_percent.toFixed(1)}%
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="cpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} unit="%" domain={[0, 100]} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                  <Area type="monotone" dataKey="cpu_percent" name="CPU %" stroke="#3b82f6" fill="url(#cpu)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Memory Usage</h3>
                <span className="text-xs tabular-nums text-gray-500">
                  {last ? `${fmtBytes(last.mem_used)} / ${fmtBytes(last.mem_total)}` : ''}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="mem" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} unit="%" domain={[0, 100]} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                  <Area type="monotone" dataKey="mem_percent" name="Memory %" stroke="#10b981" fill="url(#mem)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Disk Usage</h3>
                <span className="text-xs tabular-nums text-gray-500">
                  {last ? `${fmtBytes(last.disk_used)} / ${fmtBytes(last.disk_total)}` : ''}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="disk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} unit="%" domain={[0, 100]} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                  <Area type="monotone" dataKey="disk_percent" name="Disk %" stroke="#f59e0b" fill="url(#disk)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Network Throughput</h3>
                <span className="text-xs tabular-nums text-gray-500">
                  {netSeries.length > 1
                    ? `↓ ${fmtBytes(netSeries[netSeries.length - 1].rx)}/s · ↑ ${fmtBytes(netSeries[netSeries.length - 1].tx)}/s`
                    : ''}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={netSeries}>
                  <defs>
                    <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={11} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={(v) => fmtBytes(v)} width={60} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => `${fmtBytes(Number(v))}/s`} />
                  <Area type="monotone" dataKey="rx" name="RX" stroke="#8b5cf6" fill="url(#rx)" />
                  <Area type="monotone" dataKey="tx" name="TX" stroke="#ec4899" fill="url(#tx)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-interface throughput — one uniform card per interface */}
          {ifaceSeries.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Per-Interface Throughput
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {ifaceSeries.map((s) => {
                  const lastPt = s.points[s.points.length - 1]
                  return (
                    <div key={s.name} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="mb-2 flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-gray-700">{s.name}</h3>
                        <span className="text-xs tabular-nums text-gray-500">
                          {lastPt ? `↓ ${fmtBytes(lastPt.rx)}/s · ↑ ${fmtBytes(lastPt.tx)}/s` : ''}
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height={140}>
                        <AreaChart data={s.points}>
                          <defs>
                            <linearGradient id={`rx-${s.name}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id={`tx-${s.name}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#ec4899" stopOpacity={0.4} />
                              <stop offset="100%" stopColor="#ec4899" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={10} />
                          <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={(v) => fmtBytes(v)} width={45} />
                          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => `${fmtBytes(Number(v))}/s`} />
                          <Area type="monotone" dataKey="rx" name="RX" stroke="#8b5cf6" fill={`url(#rx-${s.name})`} />
                          <Area type="monotone" dataKey="tx" name="TX" stroke="#ec4899" fill={`url(#tx-${s.name})`} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* GPU — one uniform card per GPU with util + memory charts */}
          {gpuSeries.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                GPU
              </h2>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {gpuSeries.map((s) => {
                  const lastPt = s.points[s.points.length - 1]
                  return (
                    <div key={s.name} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="mb-2 flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-gray-700">{s.name}</h3>
                        <span className="text-xs tabular-nums text-gray-500">
                          {lastPt
                            ? `${lastPt.util.toFixed(0)}% · ${lastPt.temp}°C · ${fmtBytes(lastPt.memUsed)} / ${fmtBytes(lastPt.memTotal)}`
                            : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            Utilization
                          </div>
                          <ResponsiveContainer width="100%" height={110}>
                            <AreaChart data={s.points}>
                              <defs>
                                <linearGradient id={`gpu-util-${s.name}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={9} />
                              <YAxis stroke="#9ca3af" fontSize={9} unit="%" domain={[0, 100]} width={35} />
                              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                              <Area type="monotone" dataKey="util" name="Utilization" stroke="#22c55e" fill={`url(#gpu-util-${s.name})`} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            Memory
                          </div>
                          <ResponsiveContainer width="100%" height={110}>
                            <AreaChart data={s.points}>
                              <defs>
                                <linearGradient id={`gpu-mem-${s.name}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.4} />
                                  <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="time" tickFormatter={fmtTime} stroke="#9ca3af" fontSize={9} />
                              <YAxis stroke="#9ca3af" fontSize={9} tickFormatter={(v) => fmtBytes(v)} width={45} />
                              <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} formatter={(v: any) => fmtBytes(Number(v))} />
                              <Area type="monotone" dataKey="memUsed" name="Memory" stroke="#14b8a6" fill={`url(#gpu-mem-${s.name})`} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}