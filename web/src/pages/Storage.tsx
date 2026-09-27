import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Spinner from '../components/Spinner'
import Wizard from '../components/Wizard'

const inputCls =
  'w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">{label}</label>
      {children}
    </div>
  )
}

export default function Storage() {
  const [pools, setPools] = useState<any[]>([])
  const [volumes, setVolumes] = useState<Record<string, any[]>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [createPool, setCreatePool] = useState(false)
  const [createVol, setCreateVol] = useState<string | null>(null)
  const [assistOpen, setAssistOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const ps = await api.lxd.storagePools()
      setPools(ps)
      const v: Record<string, any[]> = {}
      await Promise.all(
        ps.map(async (p: any) => {
          try {
            v[p.name] = await api.lxd.storageVolumes(p.name)
          } catch {
            v[p.name] = []
          }
        }),
      )
      setVolumes(v)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function delVolume(pool: string, name: string) {
    if (!window.confirm(`Delete volume ${name} from ${pool}?`)) return
    setBusy(`vol:${name}`)
    try {
      await api.lxd.deleteStorageVolume(pool, name)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function delPool(name: string) {
    if (!window.confirm(`Delete storage pool ${name}? This cannot be undone.`)) return
    setBusy(`pool:${name}`)
    try {
      await api.lxd.deleteStoragePool(name)
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
        <h1 className="text-xl font-bold text-gray-900">Storage</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAssistOpen(true)}
            className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button
            onClick={() => setCreatePool(true)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            + Create pool
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {pools.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          No storage pools found
        </div>
      )}

      <div className="space-y-4">
        {pools.map((p) => (
          <div key={p.name} className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="font-semibold text-gray-900">{p.name}</h2>
                <p className="text-xs text-gray-500">
                  {p.driver} · {p.status}
                  {p.config?.['size'] ? ` · ${p.config['size']}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCreateVol(p.name)}
                  className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                >
                  + Volume
                </button>
                <button
                  onClick={() => delPool(p.name)}
                  disabled={busy === `pool:${p.name}`}
                  className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
                >
                  {busy === `pool:${p.name}` ? '…' : 'Delete pool'}
                </button>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {(volumes[p.name] || []).length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500">No custom volumes.</p>
              ) : (
                (volumes[p.name] || []).map((v) => (
                  <div key={v.name} className="flex items-center justify-between px-4 py-2 text-sm">
                    <div>
                      <span className="text-gray-900">{v.name}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {v.content_type || 'filesystem'}
                        {v.config?.size ? ` · ${v.config.size}` : ''}
                        {v.used_by?.length ? ` · used by ${v.used_by.length}` : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => delVolume(p.name, v.name)}
                      disabled={busy === `vol:${v.name}`}
                      className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
                    >
                      {busy === `vol:${v.name}` ? <Spinner /> : 'Delete'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {createPool && (
        <CreatePoolModal
          onClose={() => setCreatePool(false)}
          onCreated={() => {
            setCreatePool(false)
            load()
          }}
        />
      )}
      {createVol && (
        <CreateVolumeModal
          pool={createVol}
          onClose={() => setCreateVol(null)}
          onCreated={() => {
            setCreateVol(null)
            load()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — Storage"
          placeholder="e.g. create a zfs storage pool called fast with 10GB size"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-storage-pool') {
              await api.lxd.createStoragePool(payload)
              await load()
              return
            }
            if (action === 'create-storage-volume') {
              await api.lxd.createStorageVolume(payload.pool || 'default', payload)
              await load()
              return
            }
            throw new Error(`Unsupported action: ${action}`)
          }}
        />
      )}
    </div>
  )
}

function CreatePoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [driver, setDriver] = useState('dir')
  const [size, setSize] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.lxd.createStoragePool({ name, driver, size })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wizard
      title="Create storage pool"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create pool"
      steps={[
        {
          label: 'Basics',
          valid: name.trim() !== '' && driver !== '',
          body: (
            <div className="space-y-3">
              <Field label="Name *">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="data" className={inputCls} />
              </Field>
              <Field label="Driver *">
                <select value={driver} onChange={(e) => setDriver(e.target.value)} className={inputCls}>
                  <option value="dir">dir</option>
                  <option value="btrfs">btrfs</option>
                  <option value="zfs">zfs</option>
                  <option value="lvm">lvm</option>
                  <option value="ceph">ceph</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">dir</code> is
                  simplest; <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">btrfs</code>/
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">zfs</code> add
                  snapshots and quotas.
                </p>
              </Field>
            </div>
          ),
        },
        {
          label: 'Size',
          body: (
            <div className="space-y-3">
              <Field label="Size (optional, e.g. 50GiB)">
                <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="50GiB" className={inputCls} />
              </Field>
              <p className="text-xs text-gray-500">
                Leave empty to use all available space on the disk.
              </p>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="Driver" v={driver} />
              <ReviewRow k="Size" v={size || '(all space)'} />
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

function CreateVolumeModal({
  pool,
  onClose,
  onCreated,
}: {
  pool: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [contentType, setContentType] = useState('filesystem')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.lxd.createStorageVolume(pool, { name, size, content_type: contentType })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wizard
      title={`Create volume in ${pool}`}
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create volume"
      steps={[
        {
          label: 'Basics',
          valid: name.trim() !== '',
          body: (
            <div className="space-y-3">
              <Field label="Name *">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="data-vol" className={inputCls} />
              </Field>
              <Field label="Content type">
                <select value={contentType} onChange={(e) => setContentType(e.target.value)} className={inputCls}>
                  <option value="filesystem">filesystem</option>
                  <option value="block">block</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">filesystem</code>{' '}
                  for data; <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">block</code>{' '}
                  for raw disks (VMs).
                </p>
              </Field>
            </div>
          ),
        },
        {
          label: 'Size',
          body: (
            <div className="space-y-3">
              <Field label="Size (optional, e.g. 10GiB)">
                <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="10GiB" className={inputCls} />
              </Field>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Pool" v={pool} />
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="Type" v={contentType} />
              <ReviewRow k="Size" v={size || '(default)'} />
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