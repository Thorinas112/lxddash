import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Modal from '../components/Modal'
import Wizard from '../components/Wizard'
import { btnAction, btnGhost, btnPrimary } from '../components/ui'

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

export default function Networks() {
  const [networks, setNetworks] = useState<any[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [forwards, setForwards] = useState<any[]>([])
  const [forwardOpen, setForwardOpen] = useState(false)
  const [instances, setInstances] = useState<any[]>([])

  const load = useCallback(async () => {
    try {
      setNetworks(await api.lxd.networks())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const loadForwards = useCallback(async () => {
    try {
      setForwards(await api.forwards.list())
    } catch {
      /* ignore */
    }
  }, [])

  const loadInstances = useCallback(async () => {
    try {
      setInstances(await api.lxd.instances(true))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    loadForwards()
    loadInstances()
  }, [load, loadForwards, loadInstances])

  async function del(name: string) {
    if (!window.confirm(`Delete network ${name}?`)) return
    setBusy(name)
    try {
      await api.lxd.deleteNetwork(name)
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
        <h1 className="text-xl font-bold text-gray-900">Networks</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAssistOpen(true)}
            className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            + Create network
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {networks.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          No networks found
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {networks.map((n) => (
          <div key={n.name} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{n.name}</h2>
              {n.managed ? (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  managed
                </span>
              ) : (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  external
                </span>
              )}
            </div>
            <p className="mb-3 text-xs text-gray-500">
              {n.type} · {n.status}
            </p>
            <dl className="space-y-1 text-sm">
              <Row k="IPv4" v={n.config?.['ipv4.address'] || '—'} />
              <Row k="IPv6" v={n.config?.['ipv6.address'] || '—'} />
              <Row k="NAT" v={n.config?.['ipv4.nat'] === 'true' ? 'yes' : 'no'} />
              <Row k="DNS" v={n.config?.['dns.nameservers'] || '—'} />
              <Row k="Used by" v={String(n.used_by?.length || 0)} />
            </dl>
            {n.managed && (
              <button
                onClick={() => del(n.name)}
                disabled={busy === n.name}
                className="mt-3 rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
              >
                {busy === n.name ? '…' : 'Delete'}
              </button>
            )}
          </div>
        ))}
      </div>

      {createOpen && (
        <CreateNetworkModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}

      {/* Port forwards — reach containers from your PC */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Port forwards ({forwards.length})
          </h2>
          <button
            onClick={() => setForwardOpen(true)}
            className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
          >
            + Add forward
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Containers sit on the NAT'd lxdbr0 network (10.9.48.x), so your PC can't reach them
          directly. A port forward exposes a container port on the host — SSH to{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">your-pc-ip:port</code>.
        </p>
        {forwards.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white py-6 text-center text-sm text-gray-500 shadow-sm">
            No port forwards yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forwards.map((f) => (
                  <tr key={f.id} className="bg-white hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{f.name || f.id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      :{f.port} → {f.target}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      ssh user@your-pc-ip:{f.port}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Remove port forward ${f.name || f.id}?`)) return
                          try {
                            await api.forwards.remove(f.id)
                            await loadForwards()
                          } catch (e: any) {
                            setError(e.message)
                          }
                        }}
                        className={btnAction('bg-red-100 text-red-700')}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {forwardOpen && (
        <ForwardModal
          instances={instances}
          onClose={() => setForwardOpen(false)}
          onAdded={() => {
            setForwardOpen(false)
            loadForwards()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — Networks"
          placeholder="e.g. create a network called dmz with subnet 10.20.0.1/24, NAT enabled, DNS 1.1.1.1"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-network') {
              await api.lxd.createNetwork(payload)
              await load()
              return
            }
            if (action === 'create-lxd') {
              await api.lxd.create(payload)
              return
            }
            throw new Error(`Unsupported action: ${action}`)
          }}
        />
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-mono text-xs text-gray-700">{v}</dd>
    </div>
  )
}

function CreateNetworkModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [ipv4, setIpv4] = useState('')
  const [ipv6, setIpv6] = useState('')
  const [dns, setDns] = useState('')
  const [nat, setNat] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.lxd.createNetwork({ name, ipv4, ipv6, dns, nat })
      onCreated()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wizard
      title="Create network"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create network"
      steps={[
        {
          label: 'Basics',
          valid: name.trim() !== '',
          body: (
            <div className="space-y-3">
              <Field label="Name *">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="br0" className={inputCls} />
              </Field>
              <Field label="IPv4 subnet (e.g. 10.10.0.1/24)">
                <input value={ipv4} onChange={(e) => setIpv4(e.target.value)} placeholder="10.10.0.1/24" className={inputCls} />
                <p className="mt-1 text-xs text-gray-500">
                  The bridge gets this address; containers get DHCP addresses in the same subnet.
                </p>
              </Field>
              <Field label="IPv6 subnet (optional, e.g. fd42::1/64)">
                <input value={ipv6} onChange={(e) => setIpv6(e.target.value)} placeholder="fd42::1/64" className={inputCls} />
              </Field>
            </div>
          ),
        },
        {
          label: 'Options',
          body: (
            <div className="space-y-3">
              <Field label="DNS (optional, comma-separated)">
                <input value={dns} onChange={(e) => setDns(e.target.value)} placeholder="1.1.1.1,8.8.8.8" className={inputCls} />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={nat}
                  onChange={(e) => setNat(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 bg-white"
                />
                NAT to host network
              </label>
              <p className="text-xs text-gray-500">
                NAT lets containers reach the internet through the host. Leave it on unless you
                have a routed setup.
              </p>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="IPv4" v={ipv4 || '(none)'} />
              <ReviewRow k="IPv6" v={ipv6 || '(none)'} />
              <ReviewRow k="DNS" v={dns || '(default)'} />
              <ReviewRow k="NAT" v={nat ? 'yes' : 'no'} />
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

// ForwardModal creates a port forward from the host to a container.
interface ForwardInstance {
  name: string
  status: string
  state?: {
    network?: Record<string, { addresses?: { family: string; address: string }[] }>
  }
}

function ForwardModal({
  instances,
  onClose,
  onAdded,
}: {
  instances: ForwardInstance[]
  onClose: () => void
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [instance, setInstance] = useState('')
  const [port, setPort] = useState('2222')
  const [targetPort, setTargetPort] = useState('22')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Pick the first running instance by default.
  useEffect(() => {
    if (!instance) {
      const running = instances.find((i) => i.status === 'Running')
      if (running) setInstance(running.name)
    }
  }, [instances, instance])

  function instanceIP(name: string): string {
    const inst = instances.find((i) => i.name === name)
    const nets = inst?.state?.network || {}
    for (const n of Object.values(nets)) {
      const addr = n.addresses?.find((a) => a.family === 'inet' && a.address !== '127.0.0.1')
      if (addr) return addr.address
    }
    return ''
  }

  async function submit() {
    setBusy(true)
    setError('')
    const ip = instanceIP(instance)
    if (!ip) {
      setError('Instance has no IP address — is it running?')
      setBusy(false)
      return
    }
    try {
      await api.forwards.add({
        name: name || instance,
        port: parseInt(port) || 0,
        target: `${ip}:${parseInt(targetPort) || 22}`,
      })
      onAdded()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add port forward" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Exposes a container port on the host so you can reach it from your PC:{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">ssh user@your-pc-ip:{port}</code>
        </p>
        <Field label="Name (optional)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="web-01-ssh"
            className={inputCls}
          />
        </Field>
        <Field label="Instance *">
          <select value={instance} onChange={(e) => setInstance(e.target.value)} className={inputCls}>
            <option value="">Select instance…</option>
            {instances.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name} ({i.status}
                {instanceIP(i.name) ? ` · ${instanceIP(i.name)}` : ''})
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host port *">
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="2222"
              className={inputCls}
            />
          </Field>
          <Field label="Container port *">
            <input
              value={targetPort}
              onChange={(e) => setTargetPort(e.target.value)}
              placeholder="22"
              className={inputCls}
            />
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
          <button onClick={submit} disabled={busy || !instance || !port} className={btnPrimary}>
            {busy ? 'Adding…' : 'Add forward'}
          </button>
        </div>
      </div>
    </Modal>
  )
}