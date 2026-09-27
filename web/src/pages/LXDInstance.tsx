import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import Badge from '../components/Badge'
import LiveGraphsModal from '../components/LiveGraphsModal'
import Spinner from '../components/Spinner'
import { btnAction, btnGhost, btnPrimary, inputCls } from '../components/ui'

function fmtUptime(s: number): string {
  if (!s || s <= 0) return '--'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${u[i]}`
}
function fmtCPUTime(ns: number): string {
  if (!ns) return '--'
  const s = ns / 1e9
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${Math.floor(s % 60)}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

type Tab = 'overview' | 'configuration' | 'devices' | 'snapshots' | 'backups' | 'console'
type ConfigTab = 'boot' | 'cloud-init' | 'limits' | 'security' | 'migration' | 'raw'
type DeviceTab = 'disk' | 'gpu' | 'network' | 'proxy' | 'unix'

export default function LXDInstance() {
  const { name: rawName } = useParams()
  const name = decodeURIComponent(rawName || '')
  const navigate = useNavigate()
  const [inst, setInst] = useState<any>(null)
  const [state, setState] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [configTab, setConfigTab] = useState<ConfigTab>('boot')
  const [deviceTab, setDeviceTab] = useState<DeviceTab>('network')
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [backups, setBackups] = useState<any[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [graphsOpen, setGraphsOpen] = useState(false)
  const [updates, setUpdates] = useState<any>(null)
  const [editingConfig, setEditingConfig] = useState<Record<string, string>>({})
  const [saveBusy, setSaveBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [instData, stateData] = await Promise.all([
        api.lxd.instances(false).then((list: any[]) => list.find((i) => i.name === name)),
        api.lxd.instances(true).then((list: any[]) => list.find((i) => i.name === name)),
      ])
      setInst(instData)
      setState(stateData?.state || null)
      if (instData) setEditingConfig(instData.config || {})
    } catch (e: any) {
      setError(e.message)
    }
  }, [name])

  const loadSnapshots = useCallback(async () => {
    try { setSnapshots(await api.lxd.snapshots(name)) } catch { setSnapshots([]) }
  }, [name])

  const loadBackups = useCallback(async () => {
    try { setBackups(await api.lxd.backups(name)) } catch { setBackups([]) }
  }, [name])

  const loadUpdates = useCallback(async () => {
    try { setUpdates(await api.lxd.updates(name)) } catch { setUpdates(null) }
  }, [name])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'snapshots') loadSnapshots() }, [tab, loadSnapshots])
  useEffect(() => { if (tab === 'backups') loadBackups() }, [tab, loadBackups])
  useEffect(() => { loadUpdates() }, [loadUpdates])

  async function act(action: 'start' | 'stop' | 'restart') {
    setBusy(action)
    try { await api.lxd.action(name, action); await load() }
    catch (e: any) { setError(e.message) }
    finally { setBusy('') }
  }

  async function saveConfig() {
    setSaveBusy(true)
    try {
      await api.lxd.update(name, { config: editingConfig })
      await load()
    } catch (e: any) { setError(e.message) }
    finally { setSaveBusy(false) }
  }

  if (!inst) return <div className="p-8 text-center text-gray-500">{error || 'Loading...'}</div>

  const cfg = inst.config || {}
  const devices = inst.devices || {}
  const netDevices = Object.entries(devices).filter(([, d]: [string, any]) => d.type === 'nic' || d.network)
  const diskDevices = Object.entries(devices).filter(([, d]: [string, any]) => d.type === 'disk' || d.path)
  const gpuDevices = Object.entries(devices).filter(([, d]: [string, any]) => d.type === 'gpu')
  const proxyDevices = Object.entries(devices).filter(([, d]: [string, any]) => d.type === 'proxy')
  const unixDevices = Object.entries(devices).filter(([, d]: [string, any]) => d.type === 'unix-char' || d.type === 'unix-block')
  const profiles = inst.profiles || []
  const memUsage = state?.memory?.usage || 0
  const memTotal = state?.memory?.total || 0
  const memPct = memTotal > 0 ? (memUsage / memTotal) * 100 : 0

  function ConfigRow({ label, configKey, hint }: { label: string; configKey: string; hint?: string }) {
    return (
      <div className="flex items-center gap-3 py-2">
        <label className="w-48 shrink-0 text-sm text-gray-600">{label}</label>
        <input
          value={editingConfig[configKey] || ''}
          onChange={(e) => setEditingConfig({ ...editingConfig, [configKey]: e.target.value })}
          className={`${inputCls} flex-1`}
          placeholder={hint || ''}
        />
      </div>
    )
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'configuration', label: 'Configuration' },
    { key: 'devices', label: 'Devices' },
    { key: 'snapshots', label: 'Snapshots' },
    { key: 'backups', label: 'Backups' },
    { key: 'console', label: 'Console' },
  ]

  const CONFIG_TABS: { key: ConfigTab; label: string }[] = [
    { key: 'boot', label: 'Boot' },
    { key: 'cloud-init', label: 'Cloud-init' },
    { key: 'limits', label: 'Limits' },
    { key: 'security', label: 'Security' },
    { key: 'migration', label: 'Migration' },
    { key: 'raw', label: 'Raw' },
  ]

  const DEVICE_TABS: { key: DeviceTab; label: string; count: number }[] = [
    { key: 'network', label: 'Network', count: netDevices.length },
    { key: 'disk', label: 'Disk', count: diskDevices.length },
    { key: 'gpu', label: 'GPU', count: gpuDevices.length },
    { key: 'proxy', label: 'Proxy', count: proxyDevices.length },
    { key: 'unix', label: 'Unix', count: unixDevices.length },
  ]

  return (
    <div>
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/lxd')} className="text-sm text-gray-500 hover:text-gray-700">
            LXD
          </button>
          <span className="text-gray-400">/</span>
          <h1 className="text-xl font-bold text-gray-900">{name}</h1>
          <Badge status={inst.status} />
          <span className="text-xs text-gray-500">{inst.type === 'virtual-machine' ? 'Virtual Machine' : 'Container'}</span>
        </div>
        <div className="flex items-center gap-2">
          {inst.status !== 'Running' && (
            <button onClick={() => act('start')} disabled={!!busy} className={btnAction('bg-green-100 text-green-700')}>
              {busy === 'start' ? <Spinner /> : 'Start'}
            </button>
          )}
          {inst.status === 'Running' && (
            <>
              <button onClick={() => act('stop')} disabled={!!busy} className={btnAction('bg-yellow-100 text-yellow-700')}>
                {busy === 'stop' ? <Spinner /> : 'Stop'}
              </button>
              <button onClick={() => act('restart')} disabled={!!busy} className={btnAction('bg-blue-100 text-blue-700')}>
                {busy === 'restart' ? <Spinner /> : 'Restart'}
              </button>
            </>
          )}
          <button onClick={() => setGraphsOpen(true)} className={btnAction('bg-indigo-100 text-indigo-700')}>
            Live graphs
          </button>
          <button onClick={() => setEditOpen(true)} className={btnAction('bg-teal-100 text-teal-700')}>
            Edit
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
          {/* State cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{inst.status}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Uptime</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{fmtUptime(state?.pid ? 0 : 0)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">CPU</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                {state?.cpu ? fmtCPUTime(state.cpu.usage) : '--'}
              </div>
              <div className="text-xs text-gray-500">{cfg['limits.cpu'] || '1'} core(s)</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Memory</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 w-24 overflow-hidden rounded bg-gray-200">
                  <div className="h-full rounded bg-purple-500" style={{ width: `${Math.min(100, memPct)}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-900">{fmtBytes(memUsage)}</span>
              </div>
              <div className="text-xs text-gray-500">/ {fmtBytes(memTotal)}</div>
            </div>
          </div>

          {/* Interfaces */}
          {state?.network && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">Interfaces</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Interface</th>
                    <th className="px-4 py-2">IPv4</th>
                    <th className="px-4 py-2">IPv6</th>
                    <th className="px-4 py-2">RX</th>
                    <th className="px-4 py-2">TX</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(state.network).map(([iface, net]: [string, any]) => {
                    const ipv4 = net.addresses?.find((a: any) => a.family === 'inet')?.address || '--'
                    const ipv6 = net.addresses?.find((a: any) => a.family === 'inet6')?.address || '--'
                    return (
                      <tr key={iface} className="bg-white">
                        <td className="px-4 py-2 font-medium text-gray-900">{iface}</td>
                        <td className="px-4 py-2 text-gray-600">{ipv4}</td>
                        <td className="px-4 py-2 text-gray-600">{ipv6}</td>
                        <td className="px-4 py-2 text-gray-600">{fmtBytes(net.counters?.bytes_received || 0)}</td>
                        <td className="px-4 py-2 text-gray-600">{fmtBytes(net.counters?.bytes_sent || 0)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Quick info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Profiles</div>
              <div className="flex flex-wrap gap-1">
                {profiles.map((p: string) => (
                  <span key={p} className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{p}</span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Updates</div>
              {updates ? (
                updates.count > 0 ? (
                  <span title={updates.packages?.join('\n')} className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {updates.count} package{updates.count > 1 ? 's' : ''} ({updates.manager})
                  </span>
                ) : (
                  <span className="text-xs text-green-600">Up to date ({updates.manager})</span>
                )
              ) : (
                <span className="text-xs text-gray-400">--</span>
              )}
            </div>
          </div>

          {/* Devices summary */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Devices</div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(devices).map(([devName, dev]: [string, any]) => (
                <span key={devName} className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                  <span className="font-medium">{devName}</span>
                  {dev.type && <span className="ml-1 text-gray-400">({dev.type})</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === CONFIGURATION TAB === */}
      {tab === 'configuration' && (
        <div className="flex gap-6">
          {/* Vertical sub-tabs */}
          <div className="w-40 shrink-0">
            <div className="flex flex-col gap-1">
              {CONFIG_TABS.map((ct) => (
                <button
                  key={ct.key}
                  onClick={() => setConfigTab(ct.key)}
                  className={`rounded px-3 py-2 text-left text-sm ${
                    configTab === ct.key
                      ? 'bg-blue-50 font-medium text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded-lg border border-gray-200 bg-white p-4">
            {configTab === 'boot' && (
              <div>
                <h3 className="mb-4 text-sm font-medium text-gray-900">Boot Configuration</h3>
                <ConfigRow label="Autostart" configKey="boot.autostart" hint="true / false" />
                <ConfigRow label="Restart policy" configKey="boot.stop.priority" hint="0-100" />
                <ConfigRow label="Init mode" configKey="linux.kernel_modules" hint="module1,module2" />
              </div>
            )}
            {configTab === 'cloud-init' && (
              <div>
                <h3 className="mb-4 text-sm font-medium text-gray-900">Cloud-init</h3>
                <ConfigRow label="Hostname" configKey="cloud-init.hostname" hint="web-01" />
                <ConfigRow label="User" configKey="cloud-init.user-data" hint="username" />
                <div className="py-2">
                  <label className="mb-1 block text-sm text-gray-600">User-data script</label>
                  <textarea
                    value={editingConfig['cloud-init.user-data'] || ''}
                    onChange={(e) => setEditingConfig({ ...editingConfig, 'cloud-init.user-data': e.target.value })}
                    rows={8}
                    className={`${inputCls} w-full font-mono text-xs`}
                    placeholder="#cloud-config\npackages:\n  - htop"
                  />
                </div>
                <ConfigRow label="SSH keys" configKey="cloud-init.ssh-keys" hint="ssh-ed25519 AAAA..." />
              </div>
            )}
            {configTab === 'limits' && (
              <div>
                <h3 className="mb-4 text-sm font-medium text-gray-900">Resource Limits</h3>
                <ConfigRow label="CPU cores" configKey="limits.cpu" hint="1" />
                <ConfigRow label="CPU allowance" configKey="limits.cpu.allowance" hint="100ms/100ms" />
                <ConfigRow label="CPU priority" configKey="limits.cpu.priority" hint="0-10" />
                <ConfigRow label="Memory" configKey="limits.memory" hint="512MiB" />
                <ConfigRow label="Memory swap" configKey="limits.memory.swap" hint="true / false" />
                <ConfigRow label="Memory swap priority" configKey="limits.memory.swap.priority" hint="0-10" />
                <ConfigRow label="Memory enforcement" configKey="limits.memory.enforce" hint="hard / soft" />
                <ConfigRow label="Disk I/O priority" configKey="limits.disk.priority" hint="0-10" />
                <ConfigRow label="Processes" configKey="limits.processes" hint="max processes" />
                <ConfigRow label="Hugepages 1GB" configKey="limits.hugepages.1GB" hint="true / false" />
              </div>
            )}
            {configTab === 'security' && (
              <div>
                <h3 className="mb-4 text-sm font-medium text-gray-900">Security</h3>
                <ConfigRow label="Privileged" configKey="security.privileged" hint="true / false" />
                <ConfigRow label="Nesting" configKey="security.nesting" hint="true / false" />
                <ConfigRow label="Keyring" configKey="security.keyring" hint="true / false" />
                <ConfigRow label="ID map group" configKey="security.idmap.group" hint="group name" />
                <ConfigRow label="ID map base" configKey="security.idmap.base" hint="base uid" />
              </div>
            )}
            {configTab === 'migration' && (
              <div>
                <h3 className="mb-4 text-sm font-medium text-gray-900">Migration</h3>
                <ConfigRow label="Incremental memory" configKey="migration.incremental.memory" hint="true / false" />
                <ConfigRow label="Incremental memory goal" configKey="migration.incremental.memory.goal" hint="80" />
                <ConfigRow label="Incremental memory iterations" configKey="migration.incremental.memory.iterations" hint="10" />
                <ConfigRow label="Stateful" configKey="migration.stateful" hint="true / false" />
              </div>
            )}
            {configTab === 'raw' && (
              <div>
                <h3 className="mb-4 text-sm font-medium text-gray-900">Raw LXD configuration</h3>
                <p className="mb-3 text-xs text-gray-500">Key-value pairs passed directly to LXD. These are expert settings.</p>
                {Object.entries(editingConfig)
                  .filter(([k]) => k.startsWith('user.') || k.startsWith('raw.'))
                  .map(([k]) => (
                    <ConfigRow key={k} label={k} configKey={k} />
                  ))}
                <div className="mt-3 flex gap-2">
                  <input id="rawKey" placeholder="key" className={`${inputCls} w-48`} />
                  <input id="rawValue" placeholder="value" className={`${inputCls} flex-1`} />
                  <button
                    onClick={() => {
                      const key = (document.getElementById('rawKey') as HTMLInputElement)?.value
                      const val = (document.getElementById('rawValue') as HTMLInputElement)?.value
                      if (key) {
                        setEditingConfig({ ...editingConfig, [key]: val })
                        ;(document.getElementById('rawKey') as HTMLInputElement).value = ''
                        ;(document.getElementById('rawValue') as HTMLInputElement).value = ''
                      }
                    }}
                    className={btnPrimary}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
              <button onClick={saveConfig} disabled={saveBusy} className={btnPrimary}>
                {saveBusy ? <Spinner /> : 'Save configuration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === DEVICES TAB === */}
      {tab === 'devices' && (
        <div className="flex gap-6">
          <div className="w-40 shrink-0">
            <div className="flex flex-col gap-1">
              {DEVICE_TABS.map((dt) => (
                <button
                  key={dt.key}
                  onClick={() => setDeviceTab(dt.key)}
                  className={`flex items-center justify-between rounded px-3 py-2 text-left text-sm ${
                    deviceTab === dt.key
                      ? 'bg-blue-50 font-medium text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>{dt.label}</span>
                  {dt.count > 0 && (
                    <span className="rounded-full bg-gray-200 px-1.5 text-[10px] text-gray-600">{dt.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Type</th>
                  {deviceTab === 'network' && <th className="px-4 py-2">Network</th>}
                  {deviceTab === 'network' && <th className="px-4 py-2">IPv4</th>}
                  {deviceTab === 'disk' && <th className="px-4 py-2">Path</th>}
                  {deviceTab === 'disk' && <th className="px-4 py-2">Pool</th>}
                  {deviceTab === 'gpu' && <th className="px-4 py-2">Vendor</th>}
                  {deviceTab === 'gpu' && <th className="px-4 py-2">Product</th>}
                  {deviceTab === 'proxy' && <th className="px-4 py-2">Listen</th>}
                  {deviceTab === 'proxy' && <th className="px-4 py-2">Connect</th>}
                  <th className="px-4 py-2">All Config</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(deviceTab === 'network' ? netDevices :
                  deviceTab === 'disk' ? diskDevices :
                  deviceTab === 'gpu' ? gpuDevices :
                  deviceTab === 'proxy' ? proxyDevices :
                  unixDevices
                ).map(([devName, dev]: [string, any]) => (
                  <tr key={devName} className="bg-white">
                    <td className="px-4 py-2 font-medium text-gray-900">{devName}</td>
                    <td className="px-4 py-2 text-gray-600">{dev.type || '--'}</td>
                    {deviceTab === 'network' && <td className="px-4 py-2 text-gray-600">{dev.network || '--'}</td>}
                    {deviceTab === 'network' && <td className="px-4 py-2 text-gray-600">{dev['ipv4.address'] || 'DHCP'}</td>}
                    {deviceTab === 'disk' && <td className="px-4 py-2 text-gray-600">{dev.path || '--'}</td>}
                    {deviceTab === 'disk' && <td className="px-4 py-2 text-gray-600">{dev.pool || '--'}</td>}
                    {deviceTab === 'gpu' && <td className="px-4 py-2 text-gray-600">{dev.vendor || '--'}</td>}
                    {deviceTab === 'gpu' && <td className="px-4 py-2 text-gray-600">{dev.product || '--'}</td>}
                    {deviceTab === 'proxy' && <td className="px-4 py-2 text-gray-600">{dev.listen || '--'}</td>}
                    {deviceTab === 'proxy' && <td className="px-4 py-2 text-gray-600">{dev.connect || '--'}</td>}
                    <td className="px-4 py-2">
                      <pre className="max-w-xs overflow-auto text-[10px] text-gray-500">
                        {JSON.stringify(dev, null, 1)}
                      </pre>
                    </td>
                  </tr>
                ))}
                {(deviceTab === 'network' ? netDevices : deviceTab === 'disk' ? diskDevices : deviceTab === 'gpu' ? gpuDevices : deviceTab === 'proxy' ? proxyDevices : unixDevices).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No {deviceTab} devices</td></tr>
                )}
              </tbody>
            </table>
          </div>
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
                    await api.lxd.createSnapshot(name, snap)
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
                <th className="px-4 py-2">Created</th>
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
                          if (confirm(`Restore snapshot "${snap.name}"?`)) {
                            try { await api.lxd.restoreSnapshot(name, snap.name); load() }
                            catch (e: any) { setError(e.message) }
                          }
                        }}
                        className={btnAction('bg-blue-100 text-blue-700')}
                      >
                        Restore
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Delete snapshot "${snap.name}"?`)) {
                            try { await api.lxd.deleteSnapshot(name, snap.name); loadSnapshots() }
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

      {/* === BACKUPS TAB === */}
      {tab === 'backups' && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">Backups ({backups.length})</span>
            <button
              onClick={async () => {
                const bk = prompt('Backup name:')
                if (bk) {
                  try { await api.lxd.createBackup(name, bk); loadBackups() }
                  catch (e: any) { setError(e.message) }
                }
              }}
              className={btnPrimary}
            >
              + Create backup
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {backups.map((bk: any) => (
                <tr key={bk.name} className="bg-white">
                  <td className="px-4 py-2 font-medium text-gray-900">{bk.name}</td>
                  <td className="px-4 py-2 text-gray-600">{bk.created_at ? new Date(bk.created_at).toLocaleString() : '--'}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={async () => {
                          if (confirm(`Restore from backup "${bk.name}"?`)) {
                            try { await api.lxd.restoreBackup(name, bk.name); load() }
                            catch (e: any) { setError(e.message) }
                          }
                        }}
                        className={btnAction('bg-blue-100 text-blue-700')}
                      >
                        Restore
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Delete backup "${bk.name}"?`)) {
                            try { await api.lxd.deleteBackup(name, bk.name); loadBackups() }
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
              {backups.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No backups</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* === CONSOLE TAB === */}
      {tab === 'console' && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-4 text-sm text-gray-600">
            Open an interactive shell in a separate window so you can keep using the dashboard.
          </p>
          <button
            onClick={() => {
              const token = localStorage.getItem('lxddash_token') || ''
              const url = `/lxd/${encodeURIComponent(name)}/console-popup?token=${token}`
              window.open(url, `_blank_${name}_console`, 'width=900,height=600,menubar=no,toolbar=no,location=no,status=no')
            }}
            className={btnPrimary}
          >
            Open console in new window
          </button>
        </div>
      )}

      {/* Modals */}
      {graphsOpen && (
        <LiveGraphsModal
          title={`Live graphs - ${name}`}
          kind="LXD"
          historyId={name}
          onClose={() => setGraphsOpen(false)}
          sample={async () => {
            const insts = await api.lxd.instances(true)
            const found = insts.find((i: any) => i.name === name)
            if (!found || found.status !== 'Running') return null
            const mem = found.state?.memory
            return {
              cpu: 0, mem: mem?.total ? (mem.usage / mem.total) * 100 : 0,
              memUsage: mem?.usage || 0, memLimit: mem?.total || 0, status: found.status,
            }
          }}
        />
      )}

      {editOpen && (
        <EditInstanceModal
          name={name}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load() }}
        />
      )}
    </div>
  )
}

function EditInstanceModal({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved: () => void }) {
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoStart, setAutoStart] = useState(false)

  useEffect(() => {
    api.lxd.instances(false).then((list: any[]) => {
      const found = list.find((i) => i.name === name)
      if (found) {
        setJsonText(JSON.stringify(found.config || {}, null, 2))
        setAutoStart(found.config?.['boot.autostart'] === 'true')
      }
    })
  }, [name])

  async function save() {
    setBusy(true)
    setError('')
    try {
      if (jsonMode) {
        const cfg = JSON.parse(jsonText)
        await api.lxd.update(name, { config: cfg })
      } else {
        const update: any = { config: { 'boot.autostart': autoStart ? 'true' : 'false' } }
        await api.lxd.update(name, update)
      }
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-900">Edit instance: {name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">x</button>
        </div>
        <div className="p-4">
          <div className="mb-4 flex gap-2 border-b border-gray-200 pb-2">
            <button
              onClick={() => setJsonMode(false)}
              className={`px-3 py-1 text-sm ${!jsonMode ? 'font-medium text-blue-600' : 'text-gray-500'}`}
            >
              Form
            </button>
            <button
              onClick={() => setJsonMode(true)}
              className={`px-3 py-1 text-sm ${jsonMode ? 'font-medium text-blue-600' : 'text-gray-500'}`}
            >
              JSON
            </button>
          </div>
          {error && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
          {jsonMode ? (
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={16}
              className={`${inputCls} w-full font-mono text-xs`}
            />
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                Start automatically on boot
              </label>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
