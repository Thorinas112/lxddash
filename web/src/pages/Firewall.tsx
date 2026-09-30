import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { confirm } from '../components/ConfirmDialog'
import AssistModal from '../components/AssistModal'
import Wizard from '../components/Wizard'

const inputCls =
  'w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none'

interface Rule {
  action: string
  source: string
  destination: string
  protocol: string
  source_port: string
  destination_port: string
  description: string
  state: string
}

const emptyRule = (): Rule => ({
  action: 'allow',
  source: '',
  destination: '',
  protocol: 'tcp',
  source_port: '',
  destination_port: '',
  description: '',
  state: 'enabled',
})

export default function Firewall() {
  const [acls, setAcls] = useState<any[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [editAcl, setEditAcl] = useState<any | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setAcls(await api.lxd.acls())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function del(name: string) {
    if (!(await confirm(`Delete firewall ACL ${name}?`))) return
    setBusy(name)
    try {
      await api.lxd.deleteAcl(name)
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
        <h1 className="text-xl font-bold text-gray-900">Firewall (Network ACLs)</h1>
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
            + Create ACL
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {acls.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500 shadow-sm">
          No firewall ACLs yet. Create one to control traffic to/from your networks.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {acls.map((acl) => (
          <div key={acl.name} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{acl.name}</h2>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditAcl(acl)}
                  className="rounded bg-teal-100 px-2 py-1 text-xs text-teal-700 hover:bg-teal-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => del(acl.name)}
                  disabled={busy === acl.name}
                  className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
                >
                  {busy === acl.name ? '…' : 'Delete'}
                </button>
              </div>
            </div>
            {acl.description && <p className="mb-2 text-xs text-gray-500">{acl.description}</p>}
            <p className="mb-2 text-xs text-gray-500">
              {acl.ingress?.length || 0} ingress · {acl.egress?.length || 0} egress rules
              {acl.used_by?.length ? ` · used by ${acl.used_by.length}` : ''}
            </p>
            <RuleList title="Ingress" rules={acl.ingress || []} />
            <RuleList title="Egress" rules={acl.egress || []} />
          </div>
        ))}
      </div>

      {createOpen && (
        <AclModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
      {editAcl && (
        <AclModal
          acl={editAcl}
          onClose={() => setEditAcl(null)}
          onSaved={() => {
            setEditAcl(null)
            load()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — Firewall"
          placeholder="e.g. create an ACL called web-allow that allows TCP 443 from any source to the web containers"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-acl') {
              await api.lxd.createAcl(payload)
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

function RuleList({ title, rules }: { title: string; rules: any[] }) {
  if (rules.length === 0) return null
  return (
    <div className="mb-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <ul className="space-y-1">
        {rules.map((r, i) => (
          <li key={i} className="flex items-center gap-2 rounded bg-gray-100 px-2 py-1 font-mono text-xs">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                r.action === 'allow' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {r.action}
            </span>
            <span className="text-gray-700">
              {r.protocol || 'any'}
              {r.destination_port ? `:${r.destination_port}` : ''}
            </span>
            <span className="text-gray-500">
              {r.source ? `from ${r.source}` : ''}
              {r.destination ? ` to ${r.destination}` : ''}
            </span>
            {r.description && <span className="ml-auto text-gray-500">{r.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AclModal({
  acl,
  onClose,
  onSaved,
}: {
  acl?: any
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(acl?.name || '')
  const [description, setDescription] = useState(acl?.description || '')
  const [ingress, setIngress] = useState<Rule[]>(
    acl?.ingress?.map((r: any) => ({ ...emptyRule(), ...r })) || [],
  )
  const [egress, setEgress] = useState<Rule[]>(
    acl?.egress?.map((r: any) => ({ ...emptyRule(), ...r })) || [],
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function addRule(dir: 'ingress' | 'egress') {
    if (dir === 'ingress') setIngress([...ingress, emptyRule()])
    else setEgress([...egress, emptyRule()])
  }

  function updateRule(dir: 'ingress' | 'egress', idx: number, patch: Partial<Rule>) {
    const setter = dir === 'ingress' ? setIngress : setEgress
    const list = dir === 'ingress' ? ingress : egress
    const next = list.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    setter(next)
  }

  function removeRule(dir: 'ingress' | 'egress', idx: number) {
    const setter = dir === 'ingress' ? setIngress : setEgress
    const list = dir === 'ingress' ? ingress : egress
    setter(list.filter((_, i) => i !== idx))
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const body = { name, description, ingress, egress }
      if (acl) {
        await api.lxd.updateAcl(acl.name, body)
      } else {
        await api.lxd.createAcl(body)
      }
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Wizard
      title={acl ? `Edit ACL — ${acl.name}` : 'Create ACL'}
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel={acl ? 'Save' : 'Create ACL'}
      steps={[
        {
          label: 'Basics',
          valid: acl ? true : name.trim() !== '',
          body: (
            <div className="space-y-3">
              {!acl && (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Name *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="web-acl" className={inputCls} />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Web servers"
                  className={inputCls}
                />
              </div>
              <p className="text-xs text-gray-500">
                An ACL controls traffic to/from your networks. Attach it to a network on the
                Networks page after creating it.
              </p>
            </div>
          ),
        },
        {
          label: 'Ingress',
          body: (
            <RuleEditor
              title="Ingress rules"
              rules={ingress}
              onChange={(i, p) => updateRule('ingress', i, p)}
              onRemove={(i) => removeRule('ingress', i)}
              onAdd={() => addRule('ingress')}
            />
          ),
        },
        {
          label: 'Egress',
          body: (
            <RuleEditor
              title="Egress rules"
              rules={egress}
              onChange={(i, p) => updateRule('egress', i, p)}
              onRemove={(i) => removeRule('egress', i)}
              onAdd={() => addRule('egress')}
            />
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="Ingress" v={`${ingress.length} rule(s)`} />
              <ReviewRow k="Egress" v={`${egress.length} rule(s)`} />
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

function RuleEditor({
  title,
  rules,
  onChange,
  onRemove,
  onAdd,
}: {
  title: string
  rules: Rule[]
  onChange: (idx: number, patch: Partial<Rule>) => void
  onRemove: (idx: number) => void
  onAdd: () => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <button onClick={onAdd} className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200">
          + Rule
        </button>
      </div>
      {rules.length === 0 && <p className="text-xs text-gray-500">No rules.</p>}
      {rules.map((r, i) => (
        <div key={i} className="mb-2 rounded bg-panel p-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={r.action}
              onChange={(e) => onChange(i, { action: e.target.value })}
              className={inputCls}
            >
              <option value="allow">allow</option>
              <option value="drop">drop</option>
              <option value="reject">reject</option>
            </select>
            <select
              value={r.protocol}
              onChange={(e) => onChange(i, { protocol: e.target.value })}
              className={inputCls}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
              <option value="icmp">icmp</option>
              <option value="icmp6">icmp6</option>
              <option value="">any</option>
            </select>
            <input
              value={r.source}
              onChange={(e) => onChange(i, { source: e.target.value })}
              placeholder="Source (e.g. 10.0.0.0/24)"
              className={inputCls}
            />
            <input
              value={r.destination}
              onChange={(e) => onChange(i, { destination: e.target.value })}
              placeholder="Destination"
              className={inputCls}
            />
            <input
              value={r.destination_port}
              onChange={(e) => onChange(i, { destination_port: e.target.value })}
              placeholder="Dest port (e.g. 80,443)"
              className={inputCls}
            />
            <input
              value={r.description}
              onChange={(e) => onChange(i, { description: e.target.value })}
              placeholder="Description"
              className={inputCls}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => onRemove(i)}
              className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}