import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Badge from '../components/Badge'
import { confirm } from '../components/ConfirmDialog'
import Spinner from '../components/Spinner'
import Wizard from '../components/Wizard'
import { btnAction, btnPrimary, inputCls } from '../components/ui'

interface Job {
  id: string
  name: string
  instance: string
  schedule: string
  retention: number
  enabled: boolean
  running: boolean
  last_run?: string
  last_status?: string
  last_error?: string
}

export default function Backups() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [instances, setInstances] = useState<any[]>([])
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [jobBusy, setJobBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setJobs(await api.backups.jobs())
    } catch (e: any) {
      setError(e.message)
    }
    try {
      setInstances(await api.lxd.instances(false))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
    // Poll faster while any job is running so the status updates promptly.
    const t = setInterval(() => {
      load()
    }, jobs.some((j) => j.running) ? 2000 : 10000)
    return () => clearInterval(t)
  }, [load, jobs.some((j) => j.running)])

  async function toggle(job: Job) {
    setJobBusy(job.id)
    try {
      await api.backups.toggle(job.id, !job.enabled)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setJobBusy('')
    }
  }

  async function runNow(job: Job) {
    try {
      await api.backups.runNow(job.id)
      // Optimistically mark as running for instant feedback, then
      // let the poll confirm the real state.
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, running: true } : j)))
      await load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function remove(job: Job) {
    if (!(await confirm(`Delete backup job ${job.name}?`))) return
    setJobBusy(job.id)
    try {
      await api.backups.remove(job.id)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setJobBusy('')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Scheduled Backups</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAssistOpen(true)}
            className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button onClick={() => setCreateOpen(true)} className={btnPrimary}>
            + New backup job
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {jobs.some((j) => j.running) && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <Spinner />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-700">
              {jobs.filter((j) => j.running).length} backup job{jobs.filter((j) => j.running).length !== 1 ? 's' : ''} running
            </div>
            <div className="text-xs text-amber-600/80">
              {jobs
                .filter((j) => j.running)
                .map((j) => j.instance)
                .join(', ')}
            </div>
          </div>
          <span className="animate-pulse text-xs text-amber-500">●</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{j.name}</h3>
              <div className="flex items-center gap-1">
                {j.running && (
                  <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-700">
                    <Spinner /> Running…
                  </span>
                )}
                <button
                  onClick={() => toggle(j)}
                  disabled={j.running || !!jobBusy}
                  className={`rounded px-2 py-1 text-xs ${
                    j.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {jobBusy === j.id ? '…' : j.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  onClick={() => runNow(j)}
                  disabled={j.running || !!jobBusy}
                  className={btnAction('bg-blue-100 text-blue-700')}
                >
                  {j.running ? '…' : 'Run now'}
                </button>
                <button
                  onClick={() => remove(j)}
                  disabled={j.running || !!jobBusy}
                  className={btnAction('bg-red-100 text-red-700')}
                >
                  {jobBusy === j.id ? '…' : '✕'}
                </button>
              </div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Instance</span>
                <span className="font-mono text-xs text-gray-900">{j.instance}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Schedule</span>
                <span className="capitalize text-gray-700">{j.schedule}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Retention</span>
                <span className="text-gray-700">{j.retention} backups</span>
              </div>
              {j.last_run && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Last run</span>
                  <span className="text-gray-700">{new Date(j.last_run).toLocaleString()}</span>
                </div>
              )}
              {j.last_status && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <Badge status={j.last_status} />
                </div>
              )}
              {j.last_error && (
                <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
                  {j.last_error}
                </div>
              )}
            </div>
          </div>
        ))}
        {jobs.length === 0 && (
          <div className="col-span-full rounded-lg border border-gray-200 bg-white py-8 text-center text-sm text-gray-500 shadow-sm">
            No backup jobs yet — create one to automatically back up your LXD instances
          </div>
        )}
      </div>

      {createOpen && (
        <CreateJobModal
          instances={instances}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — Backups"
          placeholder="e.g. create a daily backup of web-01 with retention of 7"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-backup') {
              await api.backups.create(payload)
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

function CreateJobModal({
  instances,
  onClose,
  onCreated,
}: {
  instances: any[]
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [instance, setInstance] = useState('')
  const [schedule, setSchedule] = useState('daily')
  const [retention, setRetention] = useState('3')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await api.backups.create({
        name: name || `${instance}-${schedule}`,
        instance,
        schedule,
        retention: parseInt(retention) || 3,
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
      title="New backup job"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create job"
      steps={[
        {
          label: 'Target',
          valid: instance !== '',
          body: (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Instance *</label>
                <select value={instance} onChange={(e) => setInstance(e.target.value)} className={inputCls}>
                  <option value="">Select instance…</option>
                  {instances.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="nightly-web-backup"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave empty to auto-generate from the instance and schedule.
                </p>
              </div>
            </div>
          ),
        },
        {
          label: 'Schedule',
          body: (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Schedule</label>
                  <select value={schedule} onChange={(e) => setSchedule(e.target.value)} className={inputCls}>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Retention</label>
                  <input
                    type="number"
                    min={1}
                    value={retention}
                    onChange={(e) => setRetention(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Older backups beyond the retention count are deleted automatically. A webhook
                notification is sent when each backup finishes.
              </p>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Instance" v={instance} />
              <ReviewRow k="Name" v={name || `${instance}-${schedule}`} />
              <ReviewRow k="Schedule" v={schedule} />
              <ReviewRow k="Retention" v={`${retention} backup(s)`} />
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