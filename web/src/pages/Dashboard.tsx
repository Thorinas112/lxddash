import { useEffect, useState } from 'react'
import { api, getToken } from '../api/client'
import StatCard from '../components/StatCard'
import ProgressBar from '../components/ProgressBar'

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null)
  const [connected, setConnected] = useState(false)
  const [updates, setUpdates] = useState<any>(null)

  useEffect(() => {
    const token = getToken()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${token}`)
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'overview') setData(msg.data)
      } catch {
        /* ignore */
      }
    }
    return () => ws.close()
  }, [])

  // Check for available OS updates.
  useEffect(() => {
    api.updates
      .status()
      .then(setUpdates)
      .catch(() => {})
  }, [])

  const host = data?.host

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Overview</h1>
        <span
          className={`flex items-center gap-2 text-xs ${connected ? 'text-green-600' : 'text-gray-500'}`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Host"
          value={host?.hostname || '—'}
          sub={host ? `${host.os} ${host.platform}` : undefined}
        />
        <StatCard
          label="CPU"
          value={host ? `${host.cpu_percent?.toFixed(1)}%` : '—'}
          sub={host ? `${host.cpu_cores} cores` : undefined}
          accent="text-blue-600"
        />
        <StatCard
          label="Memory"
          value={host ? `${host.mem_percent?.toFixed(1)}%` : '—'}
          sub={host ? `${fmtBytes(host.mem_used)} / ${fmtBytes(host.mem_total)}` : undefined}
          accent="text-purple-600"
        />
        <StatCard
          label="Disk (/)"
          value={host ? `${host.disk_percent?.toFixed(1)}%` : '—'}
          sub={host ? `${fmtBytes(host.disk_used)} / ${fmtBytes(host.disk_total)}` : undefined}
          accent="text-yellow-600"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Docker containers" value={data?.docker_count ?? '—'} />
        <StatCard label="LXD instances" value={data?.lxd_count ?? '—'} />
        <StatCard label="VMs" value={data?.vm_count ?? '—'} />
        <StatCard label="Uptime" value={host ? fmtUptime(host.uptime) : '—'} />
      </div>

      {/* Service Health */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 text-sm font-medium text-gray-700">Service Health</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { name: 'Docker', ok: (data?.docker_count ?? 0) > 0 || !!data?.docker_ok },
            { name: 'LXD', ok: (data?.lxd_count ?? 0) > 0 || !!data?.lxd_ok },
            { name: 'VMs', ok: (data?.vm_count ?? 0) > 0 || !!data?.libvirt_ok },
            { name: 'Host', ok: !!host },
          ].map((s) => (
            <div key={s.name} className="flex items-center gap-2 rounded border border-gray-100 px-3 py-2">
              <span className={`h-2.5 w-2.5 rounded-full ${s.ok ? 'bg-green-500' : 'bg-red-400'}`} />
              <span className="text-sm font-medium text-gray-700">{s.name}</span>
              <span className={`ml-auto text-xs ${s.ok ? 'text-green-600' : 'text-red-500'}`}>
                {s.ok ? 'OK' : 'Unavailable'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {host && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-gray-500">CPU usage</span>
              <span className="text-gray-900">{host.cpu_percent?.toFixed(1)}%</span>
            </div>
            <ProgressBar percent={host.cpu_percent} color="bg-blue-500" />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex justify-between text-sm">
              <span className="text-gray-500">Memory usage</span>
              <span className="text-gray-900">{host.mem_percent?.toFixed(1)}%</span>
            </div>
            <ProgressBar percent={host.mem_percent} color="bg-purple-500" />
          </div>
        </div>
      )}

      {updates && updates.available && updates.count > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <span className="text-sm font-medium text-amber-800">
                {updates.count} package{updates.count === 1 ? '' : 's'} update{updates.count === 1 ? '' : 's'} available
              </span>
            </div>
            <a href="/settings" className="text-sm font-medium text-amber-700 hover:underline">
              View updates
            </a>
          </div>
          {updates.security > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {updates.security} security update{updates.security === 1 ? '' : 's'} included
            </p>
          )}
        </div>
      )}
    </div>
  )
}