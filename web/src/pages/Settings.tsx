import { ReactNode, useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

export default function Settings() {
  const [host, setHost] = useState<any>(null)
  const [tokens, setTokens] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [created, setCreated] = useState<{ token: string; meta: any } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [updates, setUpdates] = useState<any>(null)
  const [updating, setUpdating] = useState(false)
  const [updateOut, setUpdateOut] = useState('')
  const [webhook, setWebhook] = useState('')
  const [webhookMsg, setWebhookMsg] = useState('')
  const [logUnit, setLogUnit] = useState('')
  const [logs, setLogs] = useState('')
  const [disks, setDisks] = useState<{ mounts: any[]; disks: any[] }>({ mounts: [], disks: [] })
  const [disksLoading, setDisksLoading] = useState(true)
  const [alerts, setAlerts] = useState<any>({
    enabled: false,
    cpu_percent: 0,
    mem_percent: 0,
    disk_percent: 0,
    interval: 60,
  })
  const [alertsMsg, setAlertsMsg] = useState('')

  const loadTokens = useCallback(async () => {
    try {
      setTokens(await api.tokens.list())
    } catch {
      /* ignore */
    }
  }, [])

  const loadUpdates = useCallback(async () => {
    try {
      setUpdates(await api.updates.status())
    } catch {
      /* ignore */
    }
  }, [])

  const loadWebhook = useCallback(async () => {
    try {
      const res = await api.notify.get()
      setWebhook(res.url || '')
    } catch {
      /* ignore */
    }
  }, [])

  const loadDisks = useCallback(async () => {
    try {
      setDisks(await api.host.disks())
    } catch {
      /* ignore */
    } finally {
      setDisksLoading(false)
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    try {
      setAlerts(await api.alerts.get())
    } catch {
      /* ignore */
    }
  }, [])

  async function loadLogs() {
    if (!logUnit.trim()) return
    try {
      const res = await api.host.logs(logUnit.trim())
      setLogs(res.logs || '(no output)')
    } catch (e: any) {
      setLogs(e.message)
    }
  }

  async function saveAlerts() {
    setAlertsMsg('')
    try {
      await api.alerts.set(alerts)
      setAlertsMsg('Saved.')
    } catch (e: any) {
      setAlertsMsg(e.message)
    }
  }

  useEffect(() => {
    api
      .overview()
      .then((d) => setHost(d.host))
      .catch(() => {})
    loadTokens()
    loadUpdates()
    loadWebhook()
    loadDisks()
    loadAlerts()
  }, [loadTokens, loadUpdates, loadWebhook, loadDisks, loadAlerts])

  async function saveWebhook() {
    setWebhookMsg('')
    try {
      await api.notify.set(webhook.trim())
      setWebhookMsg('Saved.')
    } catch (e: any) {
      setWebhookMsg(e.message)
    }
  }

  async function testWebhook() {
    setWebhookMsg('')
    try {
      await api.notify.test()
      setWebhookMsg('Test notification sent.')
    } catch (e: any) {
      setWebhookMsg(e.message)
    }
  }

  async function runUpgrade() {
    if (!window.confirm('Apply all pending OS package upgrades? This may take a while.')) return
    setUpdating(true)
    setUpdateOut('')
    try {
      const res = await api.updates.upgrade()
      setUpdateOut(res.output || 'Done.')
      await loadUpdates()
    } catch (e: any) {
      // The backend returns {error, output} on failure — show both.
      setUpdateOut(`${e.message}\n\n${e.body?.output || ''}`)
    } finally {
      setUpdating(false)
    }
  }

  async function createToken() {
    if (!newName.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await api.tokens.create(newName.trim())
      setCreated(res)
      setNewName('')
      await loadTokens()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeToken(id: string) {
    try {
      await api.tokens.remove(id)
      if (created?.meta.id === id) setCreated(null)
      await loadTokens()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-gray-900">Settings</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Server
          </h2>
          <dl className="space-y-2 text-sm">
            <Row k="Hostname" v={host?.hostname || '—'} />
            <Row k="OS" v={host ? `${host.os} ${host.platform}` : '—'} />
            <Row k="Kernel" v={host?.kernel || '—'} />
            <Row k="CPU cores" v={host?.cpu_cores ?? '—'} />
          </dl>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            About
          </h2>
          <p className="text-sm text-gray-600">
            LXD Dash is a self-hosted management dashboard for Ubuntu servers. It manages Docker
            containers, LXD containers and KVM/QEMU virtual machines, and can import Proxmox
            vzdump backups.
          </p>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-gray-600">
            <li>Docker Engine API (official Go client)</li>
            <li>LXD unix socket (official Go client)</li>
            <li>libvirt / QEMU (go-libvirt)</li>
            <li>Proxmox vzdump import (LXC → LXD, QEMU → libvirt)</li>
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            API tokens
          </h2>
          <p className="mb-3 text-sm text-gray-600">
            Long-lived tokens for automation (curl, scripts, MCP). Use them as{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              Authorization: Bearer lxd_…
            </code>
            . The full token is shown only once.
          </p>

          <div className="mb-4 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. backup-script"
              className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={createToken}
              disabled={busy || !newName.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create token'}
            </button>
          </div>

          {error && (
            <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {created && (
            <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="mb-1 text-sm font-medium text-emerald-300">
                Token created — copy it now, it won't be shown again:
              </p>
              <code className="block break-all rounded bg-gray-100 px-2 py-1.5 font-mono text-xs text-emerald-700">
                {created.token}
              </code>
            </div>
          )}

          {tokens.length === 0 ? (
            <p className="text-sm text-gray-500">No API tokens yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm text-gray-900">{t.name}</p>
                    <p className="font-mono text-xs text-gray-500">
                      {t.prefix}… · created {new Date(t.created_at).toLocaleString()}
                      {t.last_used && t.last_used.startsWith('0001')
                        ? ' · never used'
                        : t.last_used
                          ? ` · last used ${new Date(t.last_used).toLocaleString()}`
                          : ' · never used'}
                    </p>
                  </div>
                  <button
                    onClick={() => removeToken(t.id)}
                    className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Software updates
          </h2>
          {!updates ? (
            <p className="text-sm text-gray-500">Checking for updates…</p>
          ) : !updates.available ? (
            <p className="text-sm text-gray-500">No supported package manager found (apt/dnf).</p>
          ) : updates.count === 0 ? (
            <p className="text-sm text-emerald-400">✓ System is up to date.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-gray-600">
                <span className="font-semibold text-amber-400">{updates.count}</span> package
                {updates.count === 1 ? '' : 's'} can be upgraded
                {updates.security > 0 ? (
                  <>
                    {' '}
                    (<span className="font-semibold text-red-400">{updates.security} security</span>)
                  </>
                ) : null}
                .
              </p>
              <div className="mb-3 max-h-48 overflow-auto rounded border border-gray-800">
                <table className="w-full text-sm">
                  <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Package</th>
                      <th className="px-3 py-2">Current</th>
                      <th className="px-3 py-2">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {updates.packages.map((p: any) => (
                      <tr key={p.name} className="bg-white">
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-900">{p.name}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{p.current}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-emerald-600">{p.new}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={runUpgrade}
                disabled={updating}
                className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {updating ? 'Upgrading…' : 'Upgrade all'}
              </button>
              {updateOut && (
                <pre className="mt-3 max-h-48 overflow-auto rounded border border-gray-200 bg-gray-900 p-3 font-mono text-xs text-gray-300">
                  {updateOut}
                </pre>
              )}
            </>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Notifications (webhook)
          </h2>
          <p className="mb-3 text-sm text-gray-600">
            LXD Dash posts JSON events (backup completed/failed, etc.) to a webhook URL. Works with
            Slack, Discord, ntfy.sh, or any HTTP endpoint.
          </p>
          <div className="flex gap-2">
            <input
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              placeholder="https://ntfy.sh/my-topic or https://hooks.slack.com/…"
              className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={saveWebhook}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Save
            </button>
            <button
              onClick={testWebhook}
              className="rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
            >
              Send test
            </button>
          </div>
          {webhookMsg && <p className="mt-2 text-xs text-gray-600">{webhookMsg}</p>}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Host power
          </h2>
          <p className="mb-3 text-sm text-gray-600">
            Reboot or shut down the host machine. The dashboard will be unreachable until it comes
            back.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (window.confirm('Reboot the host now?')) api.host.power('reboot')
              }}
              className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
            >
              Reboot host
            </button>
            <button
              onClick={() => {
                if (window.confirm('Shut down the host now?')) api.host.power('poweroff')
              }}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Shut down host
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Host logs (journalctl)
          </h2>
          <div className="mb-3 flex gap-2">
            <input
              value={logUnit}
              onChange={(e) => setLogUnit(e.target.value)}
              placeholder="unit name, e.g. libvirtd, docker, lxddash"
              className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={loadLogs}
              disabled={!logUnit.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              View logs
            </button>
          </div>
          {logs && (
            <pre className="max-h-96 overflow-auto rounded border border-gray-200 bg-gray-900 p-3 font-mono text-xs text-gray-300">
              {logs}
            </pre>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Disk health
          </h2>
          {disksLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Mounts
              </h3>
              <div className="mb-4 overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Mount</th>
                      <th className="px-3 py-2">Device</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Used</th>
                      <th className="px-3 py-2">Free</th>
                      <th className="px-3 py-2">Usage</th>
                      <th className="px-3 py-2">Inodes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {disks.mounts.map((m) => (
                      <tr key={m.mount} className="bg-white">
                        <td className="px-3 py-1.5 font-medium text-gray-900">{m.mount}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{m.device}</td>
                        <td className="px-3 py-1.5 text-gray-600">{m.fstype}</td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-600">{fmtBytes(m.used)}</td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-600">{fmtBytes(m.free)}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-200">
                              <div
                                className={`h-full rounded ${
                                  m.percent > 90
                                    ? 'bg-red-500'
                                    : m.percent > 75
                                      ? 'bg-amber-500'
                                      : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(100, m.percent)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-gray-600">
                              {m.percent.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-xs tabular-nums text-gray-600">
                          {m.inodes_percent.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Physical disks (SMART)
              </h3>
              <div className="overflow-x-auto rounded border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Disk</th>
                      <th className="px-3 py-2">Model</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Size</th>
                      <th className="px-3 py-2">Health</th>
                      <th className="px-3 py-2">Temp</th>
                      <th className="px-3 py-2">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {disks.disks.map((d) => (
                      <tr key={d.name} className="bg-white">
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-900">{d.name}</td>
                        <td className="px-3 py-1.5 text-gray-600">{d.model || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-600">{d.type}</td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-600">{fmtBytes(d.size)}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              d.health === 'PASSED'
                                ? 'bg-green-100 text-green-700'
                                : d.health === 'FAILED'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {d.health}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-600">
                          {d.temp_c >= 0 ? `${d.temp_c}°C` : '—'}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-600">{d.read_errors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Alerts (webhook thresholds)
          </h2>
          <p className="mb-3 text-sm text-gray-600">
            When a threshold is exceeded, a notification is sent to the webhook URL above. Each
            alert re-fires at most once per interval.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={alerts.enabled}
                onChange={(e) => setAlerts({ ...alerts, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              Enabled
            </label>
            <Field label="CPU %">
              <input
                type="number"
                value={alerts.cpu_percent || ''}
                onChange={(e) => setAlerts({ ...alerts, cpu_percent: Number(e.target.value) })}
                placeholder="0 = off"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
              />
            </Field>
            <Field label="Memory %">
              <input
                type="number"
                value={alerts.mem_percent || ''}
                onChange={(e) => setAlerts({ ...alerts, mem_percent: Number(e.target.value) })}
                placeholder="0 = off"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
              />
            </Field>
            <Field label="Disk %">
              <input
                type="number"
                value={alerts.disk_percent || ''}
                onChange={(e) => setAlerts({ ...alerts, disk_percent: Number(e.target.value) })}
                placeholder="0 = off"
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Field label="Check interval (s)">
              <input
                type="number"
                value={alerts.interval || 60}
                onChange={(e) => setAlerts({ ...alerts, interval: Number(e.target.value) })}
                className="w-28 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </Field>
            <button
              onClick={saveAlerts}
              className="mt-5 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Save alerts
            </button>
            {alertsMsg && <p className="mt-5 text-xs text-gray-600">{alertsMsg}</p>}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Configuration
          </h2>
          <p className="text-sm text-gray-600">
            The server reads <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">/etc/lxddash/config.json</code>{' '}
            (or the path passed with <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">-config</code>)
            and <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">LXDDASH_*</code> environment
            variables. On first run, a setup page lets you create the admin account; credentials are
            stored (bcrypt-hashed) in <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">/var/lib/lxddash/admin.json</code>.
          </p>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-gray-900">{v}</dd>
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

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}