import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Badge from '../components/Badge'
import LiveGraphsModal from '../components/LiveGraphsModal'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import Wizard from '../components/Wizard'
import { btnAction, btnGhost, btnPrimary, inputCls } from '../components/ui'

interface Instance {
  name: string
  type: string
  status: string
  uptime_seconds?: number
  config?: Record<string, string>
  devices?: Record<string, { network?: string; 'ipv4.address'?: string }>
  state?: {
    network?: Record<string, { addresses?: { family: string; address: string }[] }>
    memory?: { usage?: number; total?: number }
    cpu?: { usage?: number }
    processes?: number
  }
}

interface InstanceUpdates {
  manager: string
  count: number
  packages: string[]
  running: boolean
  checked_at?: string
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

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
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

export default function LXD() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [snapshotsFor, setSnapshotsFor] = useState<string | null>(null)
  const [editFor, setEditFor] = useState<string | null>(null)
  const [backupsFor, setBackupsFor] = useState<string | null>(null)
  const [filesFor, setFilesFor] = useState<string | null>(null)
  const [graphsFor, setGraphsFor] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, InstanceUpdates>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const prevCpu = useRef<Record<string, { usage: number; t: number; cpus: number }>>({})
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const insts = await api.lxd.instances()
      setInstances(insts)
      // Check for pending package updates inside each running instance.
      const running = insts.filter((i: Instance) => i.status === 'Running')
      const results = await Promise.all(
        running.map(async (i: Instance) => {
          try {
            return { name: i.name, data: await api.lxd.updates(i.name) }
          } catch {
            return { name: i.name, data: null }
          }
        })
      )
      const map: Record<string, InstanceUpdates> = {}
      for (const r of results) if (r.data) map[r.name] = r.data
      setUpdates(map)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
    // Keep the update badges fresh.
    const t = setInterval(() => load(), 60000)
    return () => clearInterval(t)
  }, [load])

  function ipv4(inst: Instance): string {
    const nets = inst.state?.network || {}
    for (const n of Object.values(nets)) {
      const addr = n.addresses?.find((a) => a.family === 'inet' && a.address !== '127.0.0.1')
      if (addr) return addr.address
    }
    return '—'
  }

  function networkName(inst: Instance): string {
    const nic = inst.devices?.eth0
    if (nic?.network) return nic.network
    return '—'
  }

  function tags(inst: Instance): string[] {
    const raw = inst.config?.['user.tags']
    if (!raw) return []
    return raw
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">LXD Instances</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/resources')}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Live graphs
          </button>
          <button
            onClick={async () => {
              setCheckingUpdates(true)
              await load()
              setCheckingUpdates(false)
            }}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {checkingUpdates ? <Spinner /> : null}
            Check updates
          </button>
          <button
            onClick={() => setAssistOpen(true)}
            className="flex items-center gap-2 rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button onClick={() => setCreateOpen(true)} className={btnPrimary}>
            + Create instance
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
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uptime</th>
              <th className="px-4 py-3">CPU</th>
              <th className="px-4 py-3">Memory</th>
              <th className="px-4 py-3">Network</th>
              <th className="px-4 py-3">IPv4</th>
              <th className="px-4 py-3">Updates</th>
              <th className="px-4 py-3">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {instances.map((inst) => {
              const memUsage = inst.state?.memory?.usage || 0
              const memTotal = inst.state?.memory?.total || 0
              const memPct = memTotal > 0 ? (memUsage / memTotal) * 100 : 0
              return (
              <tr key={inst.name} className="bg-white hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                  <button
                    onClick={() => navigate(`/lxd/${encodeURIComponent(inst.name)}`)}
                    className="text-blue-600 hover:underline"
                  >
                    {inst.name}
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                  {inst.type === 'virtual-machine' ? 'VM' : 'Container'}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge status={inst.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-gray-600">
                  {inst.status === 'Running' ? fmtUptime(inst.uptime_seconds || 0) : '—'}
                </td>
                <td className="px-4 py-3">
                  {inst.status === 'Running' && inst.state?.cpu?.usage ? (
                    <span className="text-xs tabular-nums text-gray-600">
                      {fmtCPUTime(inst.state.cpu.usage)}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {inst.status === 'Running' && memTotal > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-200">
                        <div
                          className="h-full rounded bg-purple-500"
                          style={{ width: `${Math.min(100, memPct)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-600">
                        {fmtBytes(memUsage)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{networkName(inst)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">{ipv4(inst)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {updates[inst.name] ? (
                    updates[inst.name].count > 0 ? (
                      <span
                        title={updates[inst.name].packages.join('\n')}
                        className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                      >
                        {updates[inst.name].count} update
                        {updates[inst.name].count > 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                        Up to date
                      </span>
                    )
                  ) : inst.status === 'Running' ? (
                    <span className="text-gray-400">…</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {tags(inst).length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {tags(inst).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
              )
            })}
            {instances.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  No instances found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <CreateInstanceModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
      {snapshotsFor && (
        <SnapshotsModal name={snapshotsFor} onClose={() => setSnapshotsFor(null)} />
      )}
      {editFor && (
        <EditInstanceModal
          name={editFor}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null)
            load()
          }}
        />
      )}
      {backupsFor && (
        <BackupsModal name={backupsFor} onClose={() => setBackupsFor(null)} />
      )}
      {filesFor && (
        <FilesModal name={filesFor} onClose={() => setFilesFor(null)} />
      )}
      {graphsFor && (
        <LiveGraphsModal
          title={`Live graphs — ${graphsFor}`}
          kind="LXD"
          historyId={graphsFor}
          onClose={() => setGraphsFor(null)}
          sample={async () => {
            const insts = await api.lxd.instances(true)
            const inst = insts.find((i: any) => i.name === graphsFor)
            if (!inst || inst.status !== 'Running') return null
            const now = Date.now()
            const mem = inst.state?.memory
            const memUsage = mem?.usage || 0
            const memLimit = mem?.total || 0
            const memPct = memLimit > 0 ? (memUsage / memLimit) * 100 : 0
            const cpuUsage = inst.state?.cpu?.usage || 0
            const cpus = parseInt(inst.config?.['limits.cpu'] || '1', 10) || 1
            const prev = prevCpu.current[graphsFor]
            let cpuPct = 0
            if (prev && cpuUsage >= prev.usage && now > prev.t) {
              const wallDelta = (now - prev.t) / 1000
              if (wallDelta > 0) {
                const cpuDelta = (cpuUsage - prev.usage) / 1e9
                cpuPct = (cpuDelta / wallDelta) * 100 / cpus
              }
            }
            prevCpu.current[graphsFor] = { usage: cpuUsage, t: now, cpus }
            return { cpu: cpuPct, mem: memPct, memUsage, memLimit, status: inst.status }
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — LXD"
          placeholder="e.g. create an ubuntu container called web-01 with 2GB RAM, 2 cores, on lxdbr0 with a static IP 10.9.48.100"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-lxd') {
              await api.lxd.create(payload)
              await load()
              return
            }
            if (action === 'create-network') {
              await api.lxd.createNetwork(payload)
              return
            }
            if (action === 'create-profile') {
              await api.lxd.createProfile(payload)
              return
            }
            if (action === 'create-acl') {
              await api.lxd.createAcl(payload)
              return
            }
            if (action === 'create-backup') {
              await api.backups.create(payload)
              return
            }
            throw new Error(`Unsupported action: ${action}`)
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

function ReviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{k}</dt>
      <dd className="truncate text-right font-mono text-xs text-gray-800">{v}</dd>
    </div>
  )
}

function CreateInstanceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('container')
  const [image, setImage] = useState('')
  const [customImage, setCustomImage] = useState(false)
  const [memory, setMemory] = useState('1024')
  const [cores, setCores] = useState('1')
  const [images, setImages] = useState<any[]>([])
  const [networks, setNetworks] = useState<any[]>([])
  const [network, setNetwork] = useState('')
  const [ipv4, setIpv4] = useState('')
  const [gateway, setGateway] = useState('')
  const [dns, setDns] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [cloudHostname, setCloudHostname] = useState('')
  const [cloudUser, setCloudUser] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudSSHKeys, setCloudSSHKeys] = useState('')
  const [cloudUserData, setCloudUserData] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.lxd
      .images()
      .then((imgs) => setImages(imgs))
      .catch(() => {})
    api.lxd
      .networks()
      .then((nets) => {
        setNetworks(nets)
        // Default to the first managed bridge (e.g. lxdbr0).
        const managed = nets.find((n: any) => n.managed)
        if (managed) setNetwork(managed.name)
      })
      .catch(() => {})
  }, [])

  // Images usable for the currently selected instance type.
  const typeImages = images.filter(
    (img) => !img.type || img.type === type || (type === 'container' && img.type === 'container'),
  )

  function imageLabel(img: any): string {
    const alias = img.aliases?.[0]?.name
    const props = img.properties || {}
    const desc =
      props.description ||
      [props.os, props.release, props.version].filter(Boolean).join(' ') ||
      'image'
    const arch = img.architecture || ''
    return alias ? `${alias} — ${desc}${arch ? ` (${arch})` : ''}` : `${desc}${arch ? ` (${arch})` : ''}`
  }

  function imageValue(img: any): string {
    return img.aliases?.[0]?.name || img.fingerprint
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.lxd.create({
        name,
        type,
        image,
        network,
        ipv4_address: ipv4,
        ipv4_gateway: gateway,
        dns,
        auto_start: autoStart,
        cloud_init_hostname: cloudHostname,
        cloud_init_user: cloudUser,
        cloud_init_password: cloudPassword,
        cloud_init_ssh_keys: cloudSSHKeys,
        cloud_init_user_data: cloudUserData,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        config: {
          'limits.memory': `${memory}MiB`,
          'limits.cpu': cores,
        },
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
      title="Create LXD instance"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create instance"
      steps={[
        {
          label: 'Basics',
          valid: name.trim() !== '' && image !== '',
          body: (
            <div className="space-y-3">
              <Field label="Name *">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="web-01" className={inputCls} />
              </Field>
              <Field label="Type">
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                  <option value="container">Container</option>
                  <option value="virtual-machine">Virtual machine</option>
                </select>
              </Field>
              {typeImages.length > 0 ? (
                <Field label="Image *">
                  <select
                    value={customImage ? '__custom__' : image}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomImage(true)
                        setImage('')
                      } else {
                        setCustomImage(false)
                        setImage(e.target.value)
                      }
                    }}
                    className={inputCls}
                  >
                    <option value="" disabled>
                      Select an image…
                    </option>
                    {typeImages.map((img) => (
                      <option key={img.fingerprint} value={imageValue(img)}>
                        {imageLabel(img)}
                      </option>
                    ))}
                    <option value="__custom__">Custom (type alias or fingerprint)…</option>
                  </select>
                  {customImage && (
                    <input
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      placeholder="ubuntu/24.04"
                      className={`${inputCls} mt-2`}
                    />
                  )}
                </Field>
              ) : (
                <Field label="Image (alias or fingerprint) *">
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="ubuntu/24.04"
                    className={inputCls}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    No images cached in LXD yet. Pull one first on the Images page.
                  </p>
                </Field>
              )}
            </div>
          ),
        },
        {
          label: 'Resources',
          body: (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Memory (MiB)">
                  <input value={memory} onChange={(e) => setMemory(e.target.value)} className={inputCls} />
                </Field>
                <Field label="CPU cores">
                  <input value={cores} onChange={(e) => setCores(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Network">
                <select value={network} onChange={(e) => setNetwork(e.target.value)} className={inputCls}>
                  <option value="">Default (profile)</option>
                  {networks
                    .filter((n: any) => n.managed)
                    .map((n: any) => (
                      <option key={n.name} value={n.name}>
                        {n.name}
                        {n.config?.['ipv4.address'] ? ` (${n.config['ipv4.address']})` : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Static IPv4 (leave empty for DHCP)">
                <input
                  value={ipv4}
                  onChange={(e) => setIpv4(e.target.value)}
                  placeholder="10.9.48.100"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Must be inside the network's subnet (e.g. 10.9.48.2 – 10.9.48.254 for lxdbr0).
                </p>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Gateway (optional)">
                  <input
                    value={gateway}
                    onChange={(e) => setGateway(e.target.value)}
                    placeholder="10.9.48.1"
                    className={inputCls}
                  />
                </Field>
                <Field label="DNS (optional)">
                  <input
                    value={dns}
                    onChange={(e) => setDns(e.target.value)}
                    placeholder="1.1.1.1,8.8.8.8"
                    className={inputCls}
                  />
                </Field>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 bg-white"
                />
                Start automatically on host boot
              </label>
              <Field label="Tags (comma-separated)">
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="web,prod,nginx"
                  className={inputCls}
                />
              </Field>
            </div>
          ),
        },
        {
          label: 'Access',
          body: (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Optional: create a sudo user and inject your SSH key so you can log in from your
                PC. Add a port forward on the Networks page afterwards to reach it.
              </p>
              <Field label="Hostname (defaults to instance name)">
                <input
                  value={cloudHostname}
                  onChange={(e) => setCloudHostname(e.target.value)}
                  placeholder="web-01"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username (sudo user)">
                  <input
                    value={cloudUser}
                    onChange={(e) => setCloudUser(e.target.value)}
                    placeholder="mark"
                    className={inputCls}
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={cloudPassword}
                    onChange={(e) => setCloudPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="SSH public keys (one per line)">
                <textarea
                  value={cloudSSHKeys}
                  onChange={(e) => setCloudSSHKeys(e.target.value)}
                  rows={3}
                  placeholder="ssh-ed25519 AAAA…"
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
              <Field label="User-data script (runs on first boot)">
                <textarea
                  value={cloudUserData}
                  onChange={(e) => setCloudUserData(e.target.value)}
                  rows={4}
                  placeholder={'#cloud-config\npackages:\n  - htop'}
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="Type" v={type === 'virtual-machine' ? 'VM' : 'Container'} />
              <ReviewRow k="Image" v={image} />
              <ReviewRow k="Memory" v={`${memory} MiB`} />
              <ReviewRow k="CPU" v={`${cores} core${cores === '1' ? '' : 's'}`} />
              <ReviewRow k="Network" v={network || '(default)'} />
              <ReviewRow k="IPv4" v={ipv4 || '(DHCP)'} />
              <ReviewRow k="User" v={cloudUser || '(default)'} />
              <ReviewRow k="SSH keys" v={cloudSSHKeys ? `${cloudSSHKeys.split('\n').filter(Boolean).length} key(s)` : '—'} />
              <ReviewRow k="Tags" v={tags || '—'} />
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

function SnapshotsModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setSnapshots(await api.lxd.snapshots(name))
    } catch (e: any) {
      setError(e.message)
    }
  }, [name])

  useEffect(() => {
    load()
  }, [load])

  async function create() {
    if (!newName) return
    setBusy('create')
    try {
      await api.lxd.createSnapshot(name, newName)
      setNewName('')
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function restore(snapshot: string) {
    if (!window.confirm(`Restore ${name} to snapshot ${snapshot}?`)) return
    setBusy(snapshot)
    try {
      await api.lxd.restoreSnapshot(name, snapshot)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function remove(snapshot: string) {
    if (!window.confirm(`Delete snapshot ${snapshot}?`)) return
    setBusy(snapshot)
    try {
      await api.lxd.deleteSnapshot(name, snapshot)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title={`Snapshots — ${name}`} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="snapshot name"
          className={inputCls}
        />
        <button onClick={create} disabled={busy === 'create' || !newName} className={btnPrimary}>
          {busy === 'create' ? '…' : 'Create'}
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="divide-y divide-gray-100 rounded border border-gray-200">
        {snapshots.map((s) => (
          <div key={s.name} className="flex items-center justify-between bg-white px-3 py-2 text-sm">
            <span className="text-gray-900">{s.name}</span>
            <div className="flex gap-1">
              <button
                onClick={() => restore(s.name)}
                className={btnAction('bg-blue-100 text-blue-700')}
              >
                Restore
              </button>
              <button
                onClick={() => remove(s.name)}
                className={btnAction('bg-red-100 text-red-700')}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {snapshots.length === 0 && (
          <div className="bg-white px-3 py-4 text-center text-sm text-gray-500">
            No snapshots yet
          </div>
        )}
      </div>
    </Modal>
  )
}

function EditInstanceModal({
  name,
  onClose,
  onSaved,
}: {
  name: string
  onClose: () => void
  onSaved: () => void
}) {
  const [networks, setNetworks] = useState<any[]>([])
  const [network, setNetwork] = useState('')
  const [ipv4, setIpv4] = useState('')
  const [gateway, setGateway] = useState('')
  const [dns, setDns] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [tags, setTags] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.lxd
      .networks()
      .then((nets) => {
        setNetworks(nets)
        const managed = nets.find((n: any) => n.managed)
        if (managed) setNetwork(managed.name)
      })
      .catch(() => {})
    // Load current instance config to prefill the form.
    api.lxd
      .instances(false)
      .then((insts) => {
        const inst = insts.find((i: any) => i.name === name)
        if (!inst) return
        const nic = inst.devices?.eth0
        if (nic) {
          if (nic.network) setNetwork(nic.network)
          if (nic['ipv4.address']) setIpv4(nic['ipv4.address'])
          if (nic['ipv4.gateway']) setGateway(nic['ipv4.gateway'])
          if (nic['dns.nameservers']) setDns(nic['dns.nameservers'])
        }
        setAutoStart(inst.config?.['boot.autostart'] === 'true')
        setTags(inst.config?.['user.tags'] || '')
      })
      .catch(() => {})
  }, [name])

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.lxd.update(name, {
        network,
        ipv4_address: ipv4,
        ipv4_gateway: gateway,
        dns,
        auto_start: autoStart,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      })
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit — ${name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Network">
          <select value={network} onChange={(e) => setNetwork(e.target.value)} className={inputCls}>
            <option value="">Default (profile)</option>
            {networks
              .filter((n: any) => n.managed)
              .map((n: any) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                  {n.config?.['ipv4.address'] ? ` (${n.config['ipv4.address']})` : ''}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Static IPv4 (leave empty for DHCP)">
          <input
            value={ipv4}
            onChange={(e) => setIpv4(e.target.value)}
            placeholder="10.9.48.100"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Gateway (optional)">
            <input
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              placeholder="10.9.48.1"
              className={inputCls}
            />
          </Field>
          <Field label="DNS (optional)">
            <input
              value={dns}
              onChange={(e) => setDns(e.target.value)}
              placeholder="1.1.1.1,8.8.8.8"
              className={inputCls}
            />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 bg-white"
          />
          Start automatically on host boot
        </label>
        <Field label="Tags (comma-separated)">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="web,prod,nginx"
            className={inputCls}
          />
        </Field>
        <p className="text-xs text-gray-500">
          Changes apply after the instance is restarted.
        </p>
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
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function BackupsModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [backups, setBackups] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setBackups(await api.lxd.backups(name))
    } catch (e: any) {
      setError(e.message)
    }
  }, [name])

  useEffect(() => {
    load()
  }, [load])

  async function create() {
    if (!newName) return
    setBusy('create')
    try {
      await api.lxd.createBackup(name, newName)
      setNewName('')
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function restore(backup: string) {
    if (!window.confirm(`Restore ${name} from backup ${backup}?\n\nThis will overwrite the current instance.`)) return
    setBusy(backup)
    try {
      await api.lxd.restoreBackup(name, backup)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function remove(backup: string) {
    if (!window.confirm(`Delete backup ${backup}?`)) return
    setBusy(backup)
    try {
      await api.lxd.deleteBackup(name, backup)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title={`Backups — ${name}`} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="backup name"
          className={inputCls}
        />
        <button onClick={create} disabled={busy === 'create' || !newName} className={btnPrimary}>
          {busy === 'create' ? '…' : 'Create'}
        </button>
      </div>
      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      <div className="divide-y divide-gray-100 rounded border border-gray-200">
        {backups.map((b) => (
          <div key={b.name} className="flex items-center justify-between bg-white px-3 py-2 text-sm">
            <span className="text-gray-900">{b.name}</span>
            <div className="flex gap-1">
              <button
                onClick={() => restore(b.name)}
                className={btnAction('bg-blue-100 text-blue-700')}
              >
                Restore
              </button>
              <button
                onClick={() => remove(b.name)}
                className={btnAction('bg-red-100 text-red-700')}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {backups.length === 0 && (
          <div className="bg-white px-3 py-4 text-center text-sm text-gray-500">
            No backups yet
          </div>
        )}
      </div>
    </Modal>
  )
}

function FilesModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<any[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [uploading, setUploading] = useState(false)
  const [fileContent, setFileContent] = useState('')
  const [viewing, setViewing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setEntries(await api.lxd.files(name, path))
    } catch (e: any) {
      setError(e.message)
    }
  }, [name, path])

  useEffect(() => {
    load()
  }, [load])

  function join(p: string, child: string) {
    return p === '/' ? `/${child}` : `${p}/${child}`
  }

  async function open(entry: any) {
    if (entry.type === 'directory') {
      setPath(join(path, entry.name))
      return
    }
    // Read file content.
    setBusy(entry.name)
    try {
      const res = await fetch(
        `${'/api'}/lxd/instances/${encodeURIComponent(name)}/files?path=${encodeURIComponent(join(path, entry.name))}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('lxddash_token') || ''}` } },
      )
      if (!res.ok) throw new Error(res.statusText)
      const text = await res.text()
      setFileContent(text)
      setViewing(entry.name)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function del(entry: any) {
    if (!window.confirm(`Delete ${entry.name}?`)) return
    setBusy(entry.name)
    try {
      await api.lxd.deleteFile(name, join(path, entry.name))
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await api.lxd.uploadFile(name, join(path, file.name), file)
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <Modal title={`Files — ${name}`} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setPath(path === '/' ? '/' : path.split('/').slice(0, -1).join('/') || '/')}
          disabled={path === '/'}
          className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 disabled:opacity-40"
        >
          ← Up
        </button>
        <span className="flex-1 truncate rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700">
          {path}
        </span>
        <label className="cursor-pointer rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500">
          {uploading ? 'Uploading…' : 'Upload'}
          <input type="file" onChange={upload} className="hidden" />
        </label>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="divide-y divide-gray-100 rounded border border-gray-200">
        {entries.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between bg-white px-3 py-2 text-sm">
            <button onClick={() => open(entry)} className="flex items-center gap-2 text-left">
              <span>{entry.type === 'directory' ? 'Folder' : 'File'}</span>
              <span className="text-gray-900">{entry.name}</span>
            </button>
            <div className="flex gap-1">
              {entry.type === 'file' && (
                <button
                  onClick={() => open(entry)}
                  className={btnAction('bg-blue-100 text-blue-700')}
                >
                  {busy === entry.name ? '…' : 'View'}
                </button>
              )}
              <button
                onClick={() => del(entry)}
                className={btnAction('bg-red-100 text-red-700')}
              >
                {busy === entry.name ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="bg-white px-3 py-4 text-center text-sm text-gray-500">
            Empty directory
          </div>
        )}
      </div>

      {viewing && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="font-mono text-xs text-gray-500">{viewing}</p>
            <button
              onClick={() => setViewing(null)}
              className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700"
            >
              Close
            </button>
          </div>
          <pre className="max-h-64 overflow-auto rounded border border-gray-200 bg-gray-900 p-3 font-mono text-xs text-gray-300">
            {fileContent}
          </pre>
        </div>
      )}
    </Modal>
  )
}