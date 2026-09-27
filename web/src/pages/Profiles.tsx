import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Wizard from '../components/Wizard'
import { btnAction, btnPrimary, inputCls } from '../components/ui'

interface Profile {
  name: string
  description?: string
  config?: Record<string, string>
  devices?: Record<string, Record<string, string>>
  used_by?: string[]
}

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [editFor, setEditFor] = useState<Profile | null>(null)

  const load = useCallback(async () => {
    try {
      setProfiles(await api.lxd.profiles())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function remove(name: string) {
    if (!window.confirm(`Delete profile ${name}?`)) return
    try {
      await api.lxd.deleteProfile(name)
      await load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">LXD Profiles</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAssistOpen(true)}
            className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button onClick={() => setCreateOpen(true)} className={btnPrimary}>
            + Create profile
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {profiles.map((p) => (
          <div key={p.name} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{p.name}</h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditFor(p)}
                  className={btnAction('bg-teal-100 text-teal-700')}
                >
                  Edit
                </button>
                {p.name !== 'default' && (
                  <button
                    onClick={() => remove(p.name)}
                    className={btnAction('bg-red-100 text-red-700')}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            {p.description && <p className="mb-2 text-xs text-gray-500">{p.description}</p>}
            {p.config && Object.keys(p.config).length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Config</div>
                <div className="space-y-0.5">
                  {Object.entries(p.config).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-gray-600">{k}</span>
                      <span className="font-mono text-gray-700">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {p.devices && Object.keys(p.devices).length > 0 && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">Devices</div>
                <div className="space-y-0.5">
                  {Object.entries(p.devices).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-gray-600">{k}</span>
                      <span className="font-mono text-gray-700">{v.type || ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {p.used_by && p.used_by.length > 0 && (
              <div className="mt-2 text-xs text-gray-500">
                Used by {p.used_by.length} instance{p.used_by.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="col-span-full rounded-lg border border-gray-200 bg-white py-8 text-center text-sm text-gray-500 shadow-sm">
            No profiles found
          </div>
        )}
      </div>

      {createOpen && (
        <ProfileModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
      {editFor && (
        <ProfileModal
          profile={editFor}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null)
            load()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — Profiles"
          placeholder="e.g. create a profile called web with 2GB RAM limit, 2 CPU cores, and a NIC on lxdbr0"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-profile') {
              await api.lxd.createProfile(payload)
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

function ProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile?: Profile
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(profile?.name || '')
  const [configText, setConfigText] = useState(
    profile?.config ? JSON.stringify(profile.config, null, 2) : '',
  )
  const [devicesText, setDevicesText] = useState(
    profile?.devices ? JSON.stringify(profile.devices, null, 2) : '',
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    let config: Record<string, string> = {}
    let devices: Record<string, Record<string, string>> = {}
    try {
      if (configText.trim()) config = JSON.parse(configText)
      if (devicesText.trim()) devices = JSON.parse(devicesText)
    } catch (e: any) {
      setError('Invalid JSON: ' + e.message)
      setBusy(false)
      return
    }
    try {
      if (profile) {
        await api.lxd.updateProfile(profile.name, { config, devices })
      } else {
        await api.lxd.createProfile({ name, config, devices })
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
      title={profile ? `Edit profile — ${profile.name}` : 'Create profile'}
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel={profile ? 'Save' : 'Create profile'}
      steps={[
        {
          label: 'Basics',
          valid: profile ? true : name.trim() !== '',
          body: (
            <div className="space-y-3">
              {!profile && (
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Name *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="web-server"
                    className={inputCls}
                  />
                </div>
              )}
              <p className="text-xs text-gray-500">
                A profile bundles config and devices that can be applied to many instances — e.g.
                resource limits, a network NIC, or a disk.
              </p>
            </div>
          ),
        },
        {
          label: 'Config',
          body: (
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
                Config (JSON)
              </label>
              <textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                rows={6}
                placeholder='{"limits.cpu": "2", "limits.memory": "2GiB"}'
                className={`${inputCls} font-mono text-xs`}
              />
              <p className="mt-1 text-xs text-gray-500">
                Common keys:{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">limits.cpu</code>,{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">limits.memory</code>,{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">boot.autostart</code>
              </p>
            </div>
          ),
        },
        {
          label: 'Devices',
          body: (
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
                Devices (JSON)
              </label>
              <textarea
                value={devicesText}
                onChange={(e) => setDevicesText(e.target.value)}
                rows={6}
                placeholder='{"eth0": {"type": "nic", "network": "lxdbr0"}}'
                className={`${inputCls} font-mono text-xs`}
              />
              <p className="mt-1 text-xs text-gray-500">
                Example NIC:{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">{'{"eth0": {"type": "nic", "network": "lxdbr0"}}'}</code>
              </p>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Name" v={name} />
              <ReviewRow k="Config" v={configText ? '(JSON)' : '(empty)'} />
              <ReviewRow k="Devices" v={devicesText ? '(JSON)' : '(empty)'} />
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