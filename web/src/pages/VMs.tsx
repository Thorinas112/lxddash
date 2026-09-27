import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Badge from '../components/Badge'
import LiveGraphsModal from '../components/LiveGraphsModal'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import Wizard from '../components/Wizard'
import { btnAction, btnGhost, btnPrimary, inputCls } from '../components/ui'

interface VM {
  uuid: string
  name: string
  state: string
  vcpus: number
  memory: number
  vnc_port: number
  autostart?: boolean
}

function fmtMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

// fmtCPUTime formats nanoseconds of CPU time as a human duration.
function fmtCPUTime(ns: number): string {
  if (!ns) return '—'
  const s = ns / 1e9
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// fmtUptime formats a duration in seconds as a human string.
function fmtUptime(s: number): string {
  if (!s || s <= 0) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function VMs() {
  const [vms, setVms] = useState<VM[]>([])
  const [stats, setStats] = useState<Record<string, any>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [cloneFor, setCloneFor] = useState<VM | null>(null)
  const [snapshotsFor, setSnapshotsFor] = useState<VM | null>(null)
  const [resizeFor, setResizeFor] = useState<VM | null>(null)
  const [graphsFor, setGraphsFor] = useState<string | null>(null)
  const prevCpu = useRef<Record<string, { usage: number; t: number; cpus: number }>>({})
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setVms(await api.vms.list())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  // Poll live VM stats every 3s.
  const loadStats = useCallback(async () => {
    try {
      const list = await api.vms.stats()
      const byUuid: Record<string, any> = {}
      for (const s of list) byUuid[s.uuid] = s
      setStats(byUuid)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    loadStats()
    const t = setInterval(loadStats, 3000)
    return () => clearInterval(t)
  }, [load, loadStats])

  async function act(uuid: string, action: 'start' | 'shutdown' | 'reboot' | 'force-stop' | 'remove') {
    setBusy(uuid)
    try {
      await api.vms.action(uuid, action)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Virtual Machines (KVM/QEMU)</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/resources')}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Live graphs
          </button>
          <button
            onClick={() => setAssistOpen(true)}
            className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button onClick={() => setCreateOpen(true)} className={btnPrimary}>
            + Create VM
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Uptime</th>
              <th className="px-4 py-3">CPU</th>
              <th className="px-4 py-3">Memory</th>
              <th className="px-4 py-3">VNC</th>
              <th className="px-4 py-3">Autostart</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vms.map((v) => {
              const st = stats[v.uuid]
              return (
              <tr key={v.uuid} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{v.name}</td>
                <td className="px-4 py-3">
                  <Badge status={v.state} />
                </td>
                <td className="px-4 py-3 text-xs tabular-nums text-gray-600">
                  {v.state === 'running' ? fmtUptime(st?.uptime_seconds || 0) : '—'}
                </td>
                <td className="px-4 py-3">
                  {v.state === 'running' && st ? (
                    <span className="text-xs tabular-nums text-gray-600">
                      {st.vcpus} vCPU · {fmtCPUTime(st.cpu_time)}
                    </span>
                  ) : (
                    <span className="text-gray-600">{v.vcpus} vCPU</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {v.state === 'running' && st ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-200">
                        <div
                          className="h-full rounded bg-purple-500"
                          style={{ width: `${Math.min(100, st.mem_percent)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-600">
                        {fmtBytes(st.mem_usage)} / {fmtBytes(st.mem_limit)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-600">{fmtMem(v.memory)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {v.vnc_port > 0 ? (
                    <Link
                      to={`/vms/${v.uuid}/console`}
                      className="text-blue-600 hover:underline"
                    >
                      :{v.vnc_port}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={async () => {
                      setBusy(v.uuid)
                      try {
                        await api.vms.setAutostart(v.uuid, !v.autostart)
                        await load()
                      } catch (e: any) {
                        setError(e.message)
                      } finally {
                        setBusy('')
                      }
                    }}
                    title={v.autostart ? 'Starts on host boot' : 'Does not start on host boot'}
                    className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      v.autostart
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${v.autostart ? 'bg-green-500' : 'bg-gray-400'}`}
                    />
                    {v.autostart ? 'On' : 'Off'}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  {busy === v.uuid ? (
                    <Spinner />
                  ) : (
                    <div className="flex justify-end gap-1">
                      {v.state !== 'running' && (
                        <button
                          onClick={() => act(v.uuid, 'start')}
                          className={btnAction('bg-green-100 text-green-700')}
                        >
                          Start
                        </button>
                      )}
                      {v.state === 'running' && (
                        <>
                          <button
                            onClick={() => act(v.uuid, 'shutdown')}
                            className={btnAction('bg-yellow-100 text-yellow-700')}
                          >
                            Shutdown
                          </button>
                          <button
                            onClick={() => act(v.uuid, 'reboot')}
                            className={btnAction('bg-blue-100 text-blue-700')}
                          >
                            Reboot
                          </button>
                          <button
                            onClick={() => act(v.uuid, 'force-stop')}
                            className={btnAction('bg-orange-100 text-orange-700')}
                          >
                            Force stop
                          </button>
                        </>
                      )}
                      {v.vnc_port > 0 && v.state === 'running' && (
                        <button
                          onClick={() => window.open(`/vms/${v.uuid}/console`, `_blank_vnc_${v.uuid}`, 'width=1024,height=768,menubar=no,toolbar=no')}
                          className={btnAction('bg-purple-100 text-purple-700')}
                        >
                          VNC
                        </button>
                      )}
                      {v.state === 'running' && (
                        <button
                          onClick={() => window.open(`/vms/${v.uuid}/terminal`, `_blank_term_${v.uuid}`, 'width=900,height=600,menubar=no,toolbar=no')}
                          className={btnAction('bg-cyan-100 text-cyan-700')}
                        >
                          Terminal
                        </button>
                      )}
                      <button
                        onClick={() => setCloneFor(v)}
                        className={btnAction('bg-indigo-100 text-indigo-700')}
                      >
                        Clone
                      </button>
                      <button
                        onClick={() => setSnapshotsFor(v)}
                        className={btnAction('bg-amber-100 text-amber-700')}
                      >
                        Snapshots
                      </button>
                      <button
                        onClick={() => setResizeFor(v)}
                        className={btnAction('bg-pink-100 text-pink-700')}
                      >
                        Resize
                      </button>
                      <button
                        onClick={() => setGraphsFor(v.uuid)}
                        className={btnAction('bg-teal-100 text-teal-700')}
                      >
                        Graphs
                      </button>
                      <button
                        onClick={() => act(v.uuid, 'remove')}
                        className={btnAction('bg-red-100 text-red-700')}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
              )
            })}
            {vms.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No VMs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateVMModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — VMs"
          placeholder="e.g. create a windows-test VM with 4GB RAM, 4 cores, 50GB disk"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-vm') {
              await api.vms.create(payload)
              await load()
              return
            }
            throw new Error(`Unsupported action: ${action}`)
          }}
        />
      )}
      {cloneFor && (
        <CloneModal
          vm={cloneFor}
          onClose={() => setCloneFor(null)}
          onCloned={() => {
            setCloneFor(null)
            load()
          }}
        />
      )}
      {snapshotsFor && (
        <SnapshotsModal
          vm={snapshotsFor}
          onClose={() => setSnapshotsFor(null)}
          onChanged={() => load()}
        />
      )}
      {resizeFor && (
        <ResizeModal
          vm={resizeFor}
          onClose={() => setResizeFor(null)}
          onResized={() => {
            setResizeFor(null)
            load()
          }}
        />
      )}
      {graphsFor && (
        <LiveGraphsModal
          title={`Live graphs — ${vms.find((v) => v.uuid === graphsFor)?.name || graphsFor.slice(0, 8)}`}
          kind="VM"
          historyId={graphsFor}
          onClose={() => setGraphsFor(null)}
          sample={async () => {
            const list = await api.vms.stats()
            const s = list.find((x: any) => x.uuid === graphsFor)
            if (!s || s.state !== 'running') return null
            const now = Date.now()
            const cpus = s.vcpus || 1
            const prev = prevCpu.current[graphsFor]
            let cpuPct = 0
            if (prev && s.cpu_time >= prev.usage && now > prev.t) {
              const wallDelta = (now - prev.t) / 1000
              if (wallDelta > 0) {
                const cpuDelta = (s.cpu_time - prev.usage) / 1e9
                cpuPct = (cpuDelta / wallDelta) * 100 / cpus
              }
            }
            prevCpu.current[graphsFor] = { usage: s.cpu_time, t: now, cpus }
            return {
              cpu: cpuPct,
              mem: s.mem_percent || 0,
              memUsage: s.mem_usage || 0,
              memLimit: s.mem_limit || 0,
              status: s.state,
            }
          }}
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">{label}</label>
      {children}
    </div>
  )
}

function CreateVMModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [memory, setMemory] = useState('2048')
  const [vcpus, setVcpus] = useState('2')
  const [diskGb, setDiskGb] = useState('20')
  const [iso, setIso] = useState('')
  const [isos, setIsos] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.vms
      .isos()
      .then((list) => setIsos(list))
      .catch(() => {})
  }, [])

  async function uploadISO(file: File) {
    setUploading(true)
    setError('')
    try {
      await api.vms.uploadISO(file)
      setIsos(await api.vms.isos())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.vms.create({
        name,
        memory_mb: parseInt(memory) || 2048,
        vcpus: parseInt(vcpus) || 2,
        disk_gb: parseInt(diskGb) || 20,
        iso: iso || undefined,
      })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wizard
      title="Create VM"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create VM"
      steps={[
        {
          label: 'Basics',
          valid: name.trim() !== '',
          body: (
            <div className="space-y-3">
              <Field label="Name *">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="web-server-01"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Memory (MiB)">
                  <input value={memory} onChange={(e) => setMemory(e.target.value)} className={inputCls} />
                </Field>
                <Field label="CPU cores">
                  <input value={vcpus} onChange={(e) => setVcpus(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Disk (GB)">
                  <input value={diskGb} onChange={(e) => setDiskGb(e.target.value)} className={inputCls} />
                </Field>
              </div>
            </div>
          ),
        },
        {
          label: 'Install media',
          body: (
            <div className="space-y-3">
              <Field label="Install ISO (optional)">
                <select value={iso} onChange={(e) => setIso(e.target.value)} className={inputCls}>
                  <option value="">— none (boot from disk) —</option>
                  {isos.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} ({fmtBytes(i.size)})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Upload an ISO on the Images page, or use the picker below.
                </p>
              </Field>
              <Field label="Upload ISO">
                <input
                  type="file"
                  accept=".iso"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadISO(f)
                  }}
                  className="w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1.5 file:text-sm file:text-gray-700 hover:file:bg-gray-300"
                />
                {uploading && <div className="mt-1 text-xs text-gray-500">Uploading…</div>}
              </Field>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="Memory" v={`${memory} MiB`} />
              <ReviewRow k="CPU" v={`${vcpus} core${vcpus === '1' ? '' : 's'}`} />
              <ReviewRow k="Disk" v={`${diskGb} GB`} />
              <ReviewRow k="ISO" v={iso || '(none)'} />
              {error && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  )
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{k}</dt>
      <dd className="truncate text-right font-mono text-xs text-gray-800">{v}</dd>
    </div>
  )
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function CloneModal({
  vm,
  onClose,
  onCloned,
}: {
  vm: VM
  onClose: () => void
  onCloned: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.vms.clone(vm.uuid, name)
      onCloned()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Clone — ${vm.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Creates a copy-on-write clone of the VM's disk and a new domain. The clone starts from
          the current disk state.
        </p>
        <Field label="New name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${vm.name}-clone`}
            className={inputCls}
          />
        </Field>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !name} className={btnPrimary}>
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface Snapshot {
  name: string
  created?: string
  state?: string
  current?: boolean
  has_metadata?: boolean
}

function SnapshotsModal({
  vm,
  onClose,
  onChanged,
}: {
  vm: VM
  onClose: () => void
  onChanged: () => void
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setSnaps(await api.vms.snapshots(vm.uuid))
    } catch (e: any) {
      setError(e.message)
    }
  }, [vm.uuid])

  useEffect(() => {
    load()
  }, [load])

  async function create() {
    setBusy('create')
    setError('')
    try {
      await api.vms.createSnapshot(vm.uuid, name)
      setName('')
      await load()
      onChanged()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function revert(s: Snapshot) {
    if (!window.confirm(`Revert ${vm.name} to snapshot "${s.name}"? The VM will be restored to that state.`)) return
    setBusy(s.name)
    setError('')
    try {
      await api.vms.revertSnapshot(vm.uuid, s.name)
      await load()
      onChanged()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function remove(s: Snapshot) {
    if (!window.confirm(`Delete snapshot "${s.name}"?`)) return
    setBusy(s.name)
    setError('')
    try {
      await api.vms.deleteSnapshot(vm.uuid, s.name)
      await load()
      onChanged()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title={`Snapshots — ${vm.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="snapshot name"
            className={inputCls}
          />
          <button onClick={create} disabled={busy === 'create' || !name} className={btnPrimary}>
            {busy === 'create' ? 'Taking…' : 'Take snapshot'}
          </button>
        </div>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        {snaps.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">No snapshots yet</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {snaps.map((s) => (
                  <tr key={s.name} className="bg-white">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {s.name}
                      {s.current && (
                        <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">
                          current
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{s.state || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{s.created || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {busy === s.name ? (
                        <Spinner />
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => revert(s)}
                            className={btnAction('bg-blue-100 text-blue-700')}
                          >
                            Revert
                          </button>
                          <button
                            onClick={() => remove(s)}
                            className={btnAction('bg-red-100 text-red-700')}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end pt-2">
          <button onClick={onClose} className={btnGhost}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ResizeModal({
  vm,
  onClose,
  onResized,
}: {
  vm: VM
  onClose: () => void
  onResized: () => void
}) {
  const [vcpus, setVcpus] = useState(String(vm.vcpus || 1))
  const [memory, setMemory] = useState(String(vm.memory || 2048))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.vms.resize(vm.uuid, {
        vcpus: parseInt(vcpus) || undefined,
        memory_mb: parseInt(memory) || undefined,
      })
      onResized()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Resize — ${vm.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Changes are applied live when the VM is running and saved to its config.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU cores">
            <input value={vcpus} onChange={(e) => setVcpus(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Memory (MiB)">
            <input value={memory} onChange={(e) => setMemory(e.target.value)} className={inputCls} />
          </Field>
        </div>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy} className={btnPrimary}>
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </Modal>
  )
}