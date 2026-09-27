import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import Badge from '../components/Badge'
import Spinner from '../components/Spinner'
import { btnAction, btnGhost } from '../components/ui'

type Tab = 'overview' | 'logs' | 'graphs' | 'console'

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`
}

function fmtTime(t: string): string {
  if (!t) return '--'
  try { return new Date(t).toLocaleString() }
  catch { return t }
}

export default function DockerContainer() {
  const { id: rawId } = useParams()
  const id = decodeURIComponent(rawId || '')
  const navigate = useNavigate()
  const [container, setContainer] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  // Logs state
  const [logsText, setLogsText] = useState('')
  const [logsTail, setLogsTail] = useState('500')

  // Graphs state
  const [graphPoints, setGraphPoints] = useState<{ t: number; cpu: number; mem: number; memUsage: number; memLimit: number }[]>([])

  const containerName = container?.Name?.replace(/^\//, '') || container?.Names?.[0]?.replace(/^\//, '') || id.slice(0, 12)

  const load = useCallback(async () => {
    try {
      const data = await api.docker.container(id)
      setContainer(data)
    } catch (e: any) {
      setError(e.message)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // Auto-load logs on tab switch
  useEffect(() => {
    if (tab === 'logs') {
      api.docker.logs(id, logsTail).then(setLogsText).catch(() => setLogsText('No logs available'))
    }
  }, [tab, id, logsTail])

  // Live graph polling
  useEffect(() => {
    if (tab !== 'graphs') return
    const interval = setInterval(async () => {
      try {
        const stats = await api.docker.stats()
        const st = stats.find((s: any) => s.id === id)
        if (!st) return
        const now = Date.now()
        const cpuPct = st.cpu_percent || 0
        setGraphPoints((prev) => [
          ...prev,
          { t: now, cpu: cpuPct, mem: st.mem_percent || 0, memUsage: st.mem_usage || 0, memLimit: st.mem_limit || 0 },
        ].slice(-600))
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [tab, id])

  async function act(action: 'start' | 'stop' | 'restart') {
    setBusy(action)
    try {
      await api.docker.action(id, action)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!confirm(`Delete container ${containerName}? This cannot be undone.`)) return
    setBusy('remove')
    try {
      await api.docker.action(id, 'remove')
      navigate('/docker')
    } catch (e: any) {
      setError(e.message)
      setBusy('')
    }
  }

  const isRunning = container?.State?.Status === 'running'
  const cfg = container?.Config || {}
  const networks = container?.NetworkSettings?.Networks || {}
  const ports = container?.Ports || []
  const envVars: string[] = cfg.Env || []

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'logs', label: 'Logs' },
    { key: 'graphs', label: 'Graphs' },
    { key: 'console', label: 'Console' },
  ]

  const tooltipStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: '#111827' }
  const last = graphPoints[graphPoints.length - 1]

  if (!container && !error) return <div className="p-8 text-center text-gray-500">Loading...</div>

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/docker')} className="text-sm text-gray-500 hover:text-gray-700">
            Docker
          </button>
          <span className="text-gray-400">/</span>
          <h1 className="text-xl font-bold text-gray-900">{containerName}</h1>
          {container && <Badge status={container.State?.Status} />}
          {container?.Config?.Image && (
            <span className="text-xs text-gray-500">{container.Config.Image}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isRunning && (
            <button onClick={() => act('start')} disabled={!!busy} className={btnAction('bg-green-100 text-green-700')}>
              {busy === 'start' ? <Spinner /> : 'Start'}
            </button>
          )}
          {isRunning && (
            <>
              <button onClick={() => act('stop')} disabled={!!busy} className={btnAction('bg-yellow-100 text-yellow-700')}>
                {busy === 'stop' ? <Spinner /> : 'Stop'}
              </button>
              <button onClick={() => act('restart')} disabled={!!busy} className={btnAction('bg-blue-100 text-blue-700')}>
                {busy === 'restart' ? <Spinner /> : 'Restart'}
              </button>
            </>
          )}
          <button onClick={remove} disabled={!!busy} className={btnAction('bg-red-100 text-red-700')}>
            {busy === 'remove' ? <Spinner /> : 'Delete'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <nav className="mb-6 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Status cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{container?.State?.Status || '--'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Image</div>
              <div className="mt-1 truncate text-sm font-semibold text-gray-900">{cfg.Image || '--'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Created</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{fmtTime(container?.Created)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Status Detail</div>
              <div className="mt-1 text-sm font-semibold text-gray-900">{container?.State?.Status || '--'}</div>
            </div>
          </div>

          {/* Ports */}
          {ports.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">Ports</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Host IP</th>
                    <th className="px-4 py-2">Host Port</th>
                    <th className="px-4 py-2">Container Port</th>
                    <th className="px-4 py-2">Protocol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ports.map((p: any, i: number) => (
                    <tr key={i} className="bg-white">
                      <td className="px-4 py-2 text-gray-600">{p.IP || '0.0.0.0'}</td>
                      <td className="px-4 py-2 text-gray-900">{p.PublicPort || '--'}</td>
                      <td className="px-4 py-2 text-gray-900">{p.PrivatePort}</td>
                      <td className="px-4 py-2 text-gray-600">{p.Type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Network Interfaces */}
          {Object.keys(networks).length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">Network Interfaces</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Network</th>
                    <th className="px-4 py-2">IP Address</th>
                    <th className="px-4 py-2">Gateway</th>
                    <th className="px-4 py-2">MAC Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(networks).map(([netName, net]: [string, any]) => (
                    <tr key={netName} className="bg-white">
                      <td className="px-4 py-2 font-medium text-gray-900">{netName}</td>
                      <td className="px-4 py-2 text-gray-600">{net.IPAddress || '--'}</td>
                      <td className="px-4 py-2 text-gray-600">{net.Gateway || '--'}</td>
                      <td className="px-4 py-2 text-gray-600">{net.MacAddress || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Environment Variables */}
          {envVars.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">
                Environment Variables ({envVars.length})
              </div>
              <div className="max-h-64 overflow-auto p-4">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {envVars.map((ev, i) => {
                      const idx = ev.indexOf('=')
                      const key = idx >= 0 ? ev.slice(0, idx) : ev
                      const val = idx >= 0 ? ev.slice(idx + 1) : ''
                      const truncated = val.length > 120 ? val.slice(0, 120) + '...' : val
                      return (
                        <tr key={i}>
                          <td className="whitespace-nowrap pr-4 py-1.5 font-mono text-xs font-medium text-gray-900">{key}</td>
                          <td className="py-1.5 font-mono text-xs text-gray-600" title={val}>{truncated}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === LOGS TAB === */}
      {tab === 'logs' && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Logs</span>
              <select
                value={logsTail}
                onChange={(e) => setLogsTail(e.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
              >
                <option value="200">Tail 200</option>
                <option value="500">Tail 500</option>
                <option value="1000">Tail 1000</option>
              </select>
            </div>
            <button
              onClick={() => api.docker.logs(id, logsTail).then(setLogsText).catch(() => setLogsText('No logs available'))}
              className={btnGhost}
            >
              Refresh
            </button>
          </div>
          <pre className="max-h-[500px] overflow-auto bg-gray-900 p-4 font-mono text-xs leading-relaxed text-green-300">
            {logsText || 'Loading logs...'}
          </pre>
        </div>
      )}

      {/* === GRAPHS TAB === */}
      {tab === 'graphs' && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-sm text-gray-600">CPU</span>
              {last && <span className="text-sm font-medium text-gray-900">{last.cpu.toFixed(1)}%</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-500" />
              <span className="text-sm text-gray-600">Memory</span>
              {last && (
                <span className="text-sm font-medium text-gray-900">
                  {fmtBytes(last.memUsage)} / {fmtBytes(last.memLimit)}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">CPU %</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={graphPoints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString()} tick={{ fontSize: 10 }} stroke="#d1d5db" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#d1d5db" />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()} formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'CPU']} />
                  <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Memory %</p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={graphPoints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString()} tick={{ fontSize: 10 }} stroke="#d1d5db" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#d1d5db" />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()} formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Memory']} />
                  <Area type="monotone" dataKey="mem" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* === CONSOLE TAB === */}
      {tab === 'console' && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <div className="text-gray-400 text-sm">Console coming soon</div>
          <p className="mt-2 text-xs text-gray-500">Docker exec WebSocket support will be available in a future release.</p>
        </div>
      )}
    </div>
  )
}
