import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Badge from '../components/Badge'
import { confirm } from '../components/ConfirmDialog'
import Spinner from '../components/Spinner'
import { btnAction, btnPrimary } from '../components/ui'

interface Backup {
  path: string
  filename: string
  vmid: number
  type: string
  format: string
  size: number
  mod_time: string
}

interface Task {
  id: string
  vmid: number
  type: string
  source: string
  status: string
  progress: number
  message: string
  created_at: string
  updated_at: string
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function Proxmox() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadBackups = useCallback(async () => {
    try {
      setBackups((await api.proxmox.backups()) ?? [])
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api.proxmox.tasks())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    loadBackups()
    loadTasks()
  }, [loadBackups, loadTasks])

  // Poll tasks while any import is still running.
  useEffect(() => {
    if (!tasks.some((t) => t.status === 'running')) return
    const timer = window.setTimeout(loadTasks, 3000)
    return () => window.clearTimeout(timer)
  }, [tasks, loadTasks])

  async function doImport(b: Backup) {
    if (!(await confirm(`Import ${b.filename}?\n\nLXC backups are imported into LXD, QEMU backups into libvirt.`))) return
    setImporting(b.path)
    setError('')
    try {
      await api.proxmox.import(b.path)
      await loadTasks()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting('')
    }
  }

  async function doUpload(file: File) {
    setUploading(true)
    setUploadPct(0)
    setError('')
    try {
      await api.proxmox.upload(file, (pct) => setUploadPct(pct))
      await loadBackups()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
      setUploadPct(0)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function doDelete(b: Backup) {
    if (!(await confirm(`Delete ${b.filename}?`))) return
    setError('')
    try {
      await api.proxmox.remove(b.filename)
      await loadBackups()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Proxmox Migration</h1>
          <p className="mt-1 text-sm text-gray-500">
            Import vzdump backups from your Proxmox server. LXC containers are imported into LXD,
            QEMU VMs are imported into libvirt (KVM).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".tar.gz,.tar.zst,.tar.xz,.tar.lzo,.vma.gz,.vma.zst,.vma.lzo,.vma.xz"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) doUpload(f)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={btnPrimary}
          >
            {uploading ? `Uploading… ${uploadPct}%` : 'Upload backup'}
          </button>
          {uploading && (
            <div className="flex-1">
              <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
                <div
                  className="h-full rounded bg-blue-500 transition-all duration-300"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) doUpload(f)
        }}
        className={`mb-4 rounded-lg border-2 border-dashed px-4 py-3 text-center text-sm transition ${
          dragOver ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-700 text-gray-500'
        }`}
      >
        Drag & drop a vzdump backup here, or click “Upload backup”
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Available backups
      </h2>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">VMID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Format</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {backups.map((b) => (
              <tr key={b.path} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-900">{b.filename}</td>
                <td className="px-4 py-3 text-gray-600">{b.vmid}</td>
                <td className="px-4 py-3 text-gray-600">{b.type === 'lxc' ? 'LXC' : 'QEMU'}</td>
                <td className="px-4 py-3 text-gray-600">{b.format}</td>
                <td className="px-4 py-3 text-gray-600">{fmtBytes(b.size)}</td>
                <td className="px-4 py-3 text-gray-600">
                  {new Date(b.mod_time).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {importing === b.path ? (
                    <Spinner />
                  ) : (
                    <div className="flex justify-end gap-1">
                      <a
                        href={api.proxmox.downloadBackup(b.filename)}
                        target="_blank"
                        className={btnAction('bg-green-100 text-green-700')}
                      >
                        Download
                      </a>
                      <button
                        onClick={() => doImport(b)}
                        className={btnAction('bg-blue-100 text-blue-700')}
                      >
                        Import
                      </button>
                      <button
                        onClick={() => doDelete(b)}
                        className={btnAction('bg-red-100 text-red-700')}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {backups.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No vzdump backups found in the dump directory
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Import tasks
      </h2>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Progress</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tasks.map((t) => (
              <tr key={t.id} className="bg-white">
                <td className="px-4 py-3 font-mono text-xs text-gray-900">{t.source}</td>
                <td className="px-4 py-3">
                  <Badge status={t.status} />
                </td>
                <td className="px-4 py-3">
                  {t.status === 'running' && (
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-32 overflow-hidden rounded bg-gray-200">
                        <div
                          className="h-full rounded bg-blue-500 transition-all duration-500"
                          style={{ width: `${t.progress || 0}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-500">{t.progress || 0}%</span>
                    </div>
                  )}
                  {t.status === 'done' && <span className="text-xs text-green-600">100%</span>}
                  {t.status === 'failed' && <span className="text-xs text-red-500">-</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{t.message}</td>
                <td className="px-4 py-3 text-gray-600">
                  {new Date(t.updated_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No import tasks yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}