import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import Badge from '../components/Badge'
import Spinner from '../components/Spinner'
import { btnAction, btnPrimary, inputCls } from '../components/ui'

type Tab = 'overview' | 'snapshots' | 'console' | 'graphs'

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`
}

function fmtMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

// vm.memory is in bytes from the API, convert to display
function fmtMemBytes(bytes: number): string {
  if (!bytes) return '--'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

function fmtUptime(s: number): string {
  if (!s || s <= 0) return '--'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtCPUTime(ns: number): string {
  if (!ns) return '--'
  const s = ns / 1e9
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export default function VMDetail() {
  const { uuid: rawUuid } = useParams()
  const uuid = decodeURIComponent(rawUuid || '')
  const navigate = useNavigate()
  const [vm, setVm] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  // Snapshots state
  const [snapshots, setSnapshots] = useState<any[]>([])

  // Graphs state
  const [graphPoints, setGraphPoints] = useState<{ t: number; cpu: number; mem: number; memUsage: number; memLimit: number }[]>([])
  const prevCpu = useRef<{ usage: number; t: number; cpus: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.vms.vm(uuid)
      setVm(data)
    } catch (e: any) {
      setError(e.message)
    }
  }, [uuid])

  const loadSnapshots = useCallback(async () => {
    try { setSnapshots(await api.vms.snapshots(uuid)) }
    catch { setSnapshots([]) }
  }, [uuid])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'snapshots') loadSnapshots() }, [tab, loadSnapshots])

  // Live graph polling
  useEffect(() => {
    if (tab !== 'graphs') return
    const interval = setInterval(async () => {
      try {
        const stats = await api.vms.stats()
        const st = stats.find((s: any) => s.uuid === uuid)
        if (!st) return
        const now = Date.now()
        let cpuPct = 0
        if (prevCpu.current && st.cpu_time >= prevCpu.current.usage) {
          const wallDelta = (now - prevCpu.current.t) / 1000
          if (wallDelta > 0) {
            cpuPct = ((st.cpu_time - prevCpu.current.usage) / 1e9 / wallDelta) * 100 / (st.vcpus || 1)
          }
        }
        prevCpu.current = { usage: st.cpu_time || 0, t: now, cpus: st.vcpus || 1 }
        setGraphPoints((prev) => [
          ...prev,
          { t: now, cpu: cpuPct, mem: st.mem_percent || 0, memUsage: st.mem_usage || 0, memLimit: st.mem_limit || 0 },
        ].slice(-600))
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [tab, uuid])

  async function act(action: 'start' | 'shutdown' | 'reboot' | 'force-stop') {
    setBusy(action)
    try {
      await api.vms.action(uuid, action)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!confirm(`Delete VM ${vm?.name || uuid}? This cannot be undone.`)) return
    setBusy('remove')
    try {
      await api.vms.action(uuid, 'remove')
      navigate('/vms')
    } catch (e: any) {
      setError(e.message)
      setBusy('')
    }
  }

  const isRunning = vm?.state === 'running'
  const st = vm?.stats || {}

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'snapshots', label: 'Snapshots' },
    { key: 'console', label: 'Console' },
    { key: 'graphs', label: 'Graphs' },
  ]

  const tooltipStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: '#111827' }
  const last = graphPoints[graphPoints.length - 1]

  if (!vm && !error) return <div className="p-8 text-center text-gray-500">Loading...</div>

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/vms')} className="text-sm text-gray-500 hover:text-gray-700">
            VMs
          </button>
          <span className="text-gray-400">/</span>
          <h1 className="text-xl font-bold text-gray-900">{vm?.name || uuid}</h1>
          {vm && <Badge status={vm.state} />}
        </div>
        <div className="flex items-center gap-2">
          {!isRunning && (
            <button onClick={() => act('start')} disabled={!!busy} className={btnAction('bg-green-100 text-green-700')}>
              {busy === 'start' ? <Spinner /> : 'Start'}
            </button>
          )}
          {isRunning && (
            <>
              <button onClick={() => act('shutdown')} disabled={!!busy} className={btnAction('bg-yellow-100 text-yellow-700')} title="Sends ACPI shutdown signal (requires guest OS)">
                {busy === 'shutdown' ? <Spinner /> : 'Shutdown'}
              </button>
              <button onClick={() => act('reboot')} disabled={!!busy} className={btnAction('bg-blue-100 text-blue-700')}>
                {busy === 'reboot' ? <Spinner /> : 'Reboot'}
              </button>
              <button onClick={async () => {
                if (!confirm('Force stop will immediately kill the VM without saving state. Continue?')) return
                await act('force-stop')
              }} disabled={!!busy} className={btnAction('bg-red-100 text-red-700')} title="Immediately stops the VM (use if Shutdown does not work)">
                {busy === 'force-stop' ? <Spinner /> : 'Force stop'}
              </button>
            </>
          )}
          <button onClick={() => setTab('snapshots')} className={btnAction('bg-teal-100 text-teal-700')}>
            Edit
          </button>
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
              <div className="mt-1 text-lg font-semibold text-gray-900">{vm?.state || '--'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">vCPUs</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{vm?.vcpus || '--'}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Memory</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{vm?.memory ? fmtMemBytes(vm.memory) : '--'}</div>
              {isRunning && st.mem_usage > 0 && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded bg-gray-200">
                    <div className="h-full rounded bg-purple-500" style={{ width: `${Math.min(100, st.mem_percent || 0)}%` }} />
                  </div>
                  <span className="text-xs text-gray-500">{fmtBytes(st.mem_usage)} / {fmtBytes(st.mem_limit)}</span>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Autostart</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{vm?.autostart ? 'On' : 'Off'}</div>
            </div>
          </div>

          {/* Attach ISO — placed prominently at the top */}
          <AttachISOSection uuid={uuid} isRunning={isRunning} onDone={load} onError={setError} />

          {/* Disk */}
          {vm?.disk_size && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Disk</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtMem(vm.disk_size)}</div>
            </div>
          )}

          {/* Network Info */}
          {isRunning && st && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">Live Stats</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Metric</th>
                    <th className="px-4 py-2">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-white">
                    <td className="px-4 py-2 font-medium text-gray-900">Uptime</td>
                    <td className="px-4 py-2 text-gray-600">{fmtUptime(st.uptime_seconds || 0)}</td>
                  </tr>
                  <tr className="bg-white">
                    <td className="px-4 py-2 font-medium text-gray-900">CPU Time</td>
                    <td className="px-4 py-2 text-gray-600">{fmtCPUTime(st.cpu_time || 0)}</td>
                  </tr>
                  <tr className="bg-white">
                    <td className="px-4 py-2 font-medium text-gray-900">Memory Usage</td>
                    <td className="px-4 py-2 text-gray-600">{fmtBytes(st.mem_usage || 0)} / {fmtBytes(st.mem_limit || 0)}</td>
                  </tr>
                  {vm.vnc_port > 0 && (
                    <tr className="bg-white">
                      <td className="px-4 py-2 font-medium text-gray-900">VNC Port</td>
                      <td className="px-4 py-2 text-gray-600">:{vm.vnc_port}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === SNAPSHOTS TAB === */}
      {tab === 'snapshots' && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">Snapshots ({snapshots.length})</span>
            <button
              onClick={async () => {
                const snap = prompt('Snapshot name:')
                if (snap) {
                  try {
                    await api.vms.createSnapshot(uuid, snap)
                    loadSnapshots()
                  } catch (e: any) { setError(e.message) }
                }
              }}
              className={btnPrimary}
            >
              + Create snapshot
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Stateful</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {snapshots.map((snap: any) => (
                <tr key={snap.name} className="bg-white">
                  <td className="px-4 py-2 font-medium text-gray-900">{snap.name}</td>
                  <td className="px-4 py-2 text-gray-600">{snap.created_at ? new Date(snap.created_at).toLocaleString() : '--'}</td>
                  <td className="px-4 py-2 text-gray-600">{snap.stateful ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={async () => {
                          if (confirm(`Revert to snapshot "${snap.name}"?`)) {
                            try { await api.vms.revertSnapshot(uuid, snap.name); load() }
                            catch (e: any) { setError(e.message) }
                          }
                        }}
                        className={btnAction('bg-blue-100 text-blue-700')}
                      >
                        Revert
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Delete snapshot "${snap.name}"?`)) {
                            try { await api.vms.deleteSnapshot(uuid, snap.name); loadSnapshots() }
                            catch (e: any) { setError(e.message) }
                          }
                        }}
                        className={btnAction('bg-red-100 text-red-700')}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No snapshots</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* === CONSOLE TAB === */}
      {tab === 'console' && (
        <div className="rounded-lg border border-gray-200 bg-white p-8">
          <h3 className="mb-4 text-sm font-medium text-gray-900">Console Access</h3>
          <div className="flex gap-3">
            {vm?.vnc_port > 0 && (
              <button
                onClick={() => window.open(`/vms/${uuid}/console`, `_blank_vnc_${uuid}`, 'width=1024,height=768,menubar=no,toolbar=no')}
                className={btnPrimary}
              >
                Open VNC
              </button>
            )}
            {isRunning && (
              <button
                onClick={() => window.open(`/vms/${uuid}/terminal`, `_blank_term_${uuid}`, 'width=900,height=600,menubar=no,toolbar=no')}
                className={btnPrimary}
              >
                Open Terminal
              </button>
            )}
            {!isRunning && (
              <span className="text-sm text-gray-500">Start the VM to access console.</span>
            )}
          </div>
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
    </div>
  )
}

function AttachISOSection({ uuid, isRunning, onDone, onError }: {
  uuid: string; isRunning: boolean;
  onDone: () => void; onError: (msg: string) => void;
}) {
  const [isos, setIsos] = useState<any[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    api.vms.isos().then(setIsos).catch(() => {})
  }, [])

  async function attach() {
    setBusy(true)
    try {
      await api.vms.attachISO(uuid, selected)
      onDone()
    } catch (e: any) { onError(e.message) }
    finally { setBusy(false) }
  }

  async function detach() {
    setBusy(true)
    try {
      await api.vms.attachISO(uuid, '')
      onDone()
    } catch (e: any) { onError(e.message) }
    finally { setBusy(false) }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.vms.uploadISO(file)
      setIsos(await api.vms.isos())
    } catch (err: any) { onError(err.message) }
    finally { setUploading(false); e.target.value = '' }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 text-xs uppercase tracking-wide text-gray-500">Boot Media</div>
      <p className="mb-3 text-sm text-gray-600">
        Attach an ISO to install an operating system. The VM must be shut down.
      </p>
      <div className="flex items-center gap-3">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className={`${inputCls} flex-1`}
          disabled={isRunning}>
          <option value="">No ISO selected</option>
          {isos.map((iso) => (
            <option key={iso.name} value={iso.name}>{iso.name} ({fmtBytes(iso.size)})</option>
          ))}
        </select>
        <button onClick={attach} disabled={isRunning || busy || !selected} className={btnPrimary}>
          {busy ? <Spinner /> : 'Attach'}
        </button>
        <button onClick={detach} disabled={isRunning || busy} className={btnAction('bg-red-100 text-red-700')}>
          Detach
        </button>
        <label className="cursor-pointer rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          {uploading ? 'Uploading...' : 'Upload ISO'}
          <input type="file" accept=".iso" onChange={upload} className="hidden" />
        </label>
      </div>
    </div>
  )
}
