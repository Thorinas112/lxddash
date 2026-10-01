import { ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import AssistModal from '../components/AssistModal'
import Badge from '../components/Badge'
import LiveGraphsModal from '../components/LiveGraphsModal'
import Modal from '../components/Modal'
import ProgressBar from '../components/ProgressBar'
import { confirm, promptInline } from '../components/ConfirmDialog'
import Spinner from '../components/Spinner'
import Wizard from '../components/Wizard'
import { btnAction, btnGhost, btnPrimary, inputCls } from '../components/ui'

interface Container {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Ports: { IP: string; PrivatePort: number; PublicPort: number; Type: string }[]
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function Docker() {
  const [tab, setTab] = useState<'containers' | 'images' | 'volumes' | 'networks'>('containers')
  const [containers, setContainers] = useState<Container[]>([])
  const [stats, setStats] = useState<Record<string, any>>({})
  const [images, setImages] = useState<any[]>([])
  const [volumes, setVolumes] = useState<any[]>([])
  const [networks, setNetworks] = useState<any[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [pullOpen, setPullOpen] = useState(false)
  const [logsId, setLogsId] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [graphsFor, setGraphsFor] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState('')
  const [containerTags, setContainerTags] = useState<Record<string, string[]>>({})
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setContainers(await api.docker.containers())
    } catch (e: any) {
      setError(e.message)
    }
    try {
      setImages(await api.docker.images())
    } catch (e: any) {
      setError(e.message)
    }
    try {
      setVolumes(await api.docker.volumes())
    } catch (e: any) {
      setError(e.message)
    }
    try {
      setNetworks(await api.docker.networks())
    } catch (e: any) {
      setError(e.message)
    }
    // Load tags for all containers.
    try {
      const cs = await api.docker.containers()
      const tagMap: Record<string, string[]> = {}
      await Promise.all(cs.map(async (c: any) => {
        try { tagMap[c.Id] = await api.tags.get(c.Id) } catch { tagMap[c.Id] = [] }
      }))
      setContainerTags(tagMap)
    } catch { /* ignore */ }
  }, [])

  // Poll live container stats every 3s.
  const loadStats = useCallback(async () => {
    try {
      const list = await api.docker.stats()
      const byId: Record<string, any> = {}
      for (const s of list) byId[s.id] = s
      setStats(byId)
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

  useEffect(() => {
    load()
  }, [load])

  async function act(id: string, action: 'start' | 'stop' | 'restart' | 'remove') {
    setBusy(id)
    try {
      await api.docker.action(id, action)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function openLogs(id: string) {
    setLogsId(id)
    setLogs('')
    try {
      setLogs(await api.docker.logs(id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Docker Containers</h1>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/resources')}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Live graphs
          </button>
          <button onClick={() => setPullOpen(true)} className={btnGhost}>
            Pull image
          </button>
          <button onClick={() => setComposeOpen(true)} className={btnGhost}>
            Compose
          </button>
          <button
            onClick={() => setAssistOpen(true)}
            className="rounded-md border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
          >
            AI
          </button>
          <button onClick={() => setCreateOpen(true)} className={btnPrimary}>
            + Create container
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {(['containers', 'images', 'volumes', 'networks'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded px-3 py-1.5 text-sm capitalize transition ${
              tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t}
            <span className="ml-1 text-xs opacity-70">
              {t === 'containers' ? containers.length : t === 'images' ? images.length : t === 'volumes' ? volumes.length : networks.length}
            </span>
          </button>
        ))}
      </div>

      {tab === 'containers' && (
      <div>
        {selected.size > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
            <span className="text-xs text-blue-700">{selected.size} selected</span>
            <button disabled={!!bulkBusy} onClick={async () => { setBulkBusy('start'); try { await api.docker.bulkAction([...selected], 'start') } finally { setBulkBusy(''); setSelected(new Set()); load() } }} className={btnAction('bg-green-100 text-green-700')}>{bulkBusy === 'start' ? '…' : 'Start'}</button>
            <button disabled={!!bulkBusy} onClick={async () => { setBulkBusy('stop'); try { await api.docker.bulkAction([...selected], 'stop') } finally { setBulkBusy(''); setSelected(new Set()); load() } }} className={btnAction('bg-amber-100 text-amber-700')}>{bulkBusy === 'stop' ? '…' : 'Stop'}</button>
            <button disabled={!!bulkBusy} onClick={async () => { setBulkBusy('restart'); try { await api.docker.bulkAction([...selected], 'restart') } finally { setBulkBusy(''); setSelected(new Set()); load() } }} className={btnAction('bg-blue-100 text-blue-700')}>{bulkBusy === 'restart' ? '…' : 'Restart'}</button>
            <button disabled={!!bulkBusy} onClick={async () => { if (await confirm(`Remove ${selected.size} containers?`)) { setBulkBusy('remove'); try { await api.docker.bulkAction([...selected], 'remove') } finally { setBulkBusy(''); setSelected(new Set()); load() } } }} className={btnAction('bg-red-100 text-red-700')}>{bulkBusy === 'remove' ? '…' : 'Remove'}</button>
            <button onClick={() => setSelected(new Set())} className={btnAction('bg-gray-100 text-gray-700')}>Clear</button>
          </div>
        )}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={containers.length > 0 && containers.every(c => selected.has(c.Id))} onChange={e => { if (e.target.checked) setSelected(new Set(containers.map(c => c.Id))); else setSelected(new Set()) }} className="h-3.5 w-3.5 rounded border-gray-300" />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Image</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uptime</th>
              <th className="px-4 py-3">CPU</th>
              <th className="px-4 py-3">Memory</th>
              <th className="px-4 py-3">Ports</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {containers.map((c) => {
              const st = stats[c.Id]
              return (
              <tr key={c.Id} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-3 w-8">
                  <input type="checkbox" checked={selected.has(c.Id)} onChange={e => { const next = new Set(selected); if (e.target.checked) next.add(c.Id); else next.delete(c.Id); setSelected(next) }} className="h-3.5 w-3.5 rounded border-gray-300" />
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  <Link to={`/docker/${c.Id}`} className="text-blue-600 hover:underline">
                    {c.Names[0]?.replace(/^\//, '') || c.Id.slice(0, 12)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{c.Image}</td>
                <td className="px-4 py-3">
                  <Badge status={c.State} />
                </td>
                <td className="px-4 py-3 text-xs tabular-nums text-gray-600">
                  {c.State === 'running' ? c.Status.replace(/^Up\s+/i, '') : '—'}
                </td>
                <td className="px-4 py-3">
                  {c.State === 'running' && st ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-200">
                        <div
                          className="h-full rounded bg-blue-500"
                          style={{ width: `${Math.min(100, st.cpu_percent)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-600">
                        {st.cpu_percent.toFixed(1)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.State === 'running' && st ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-200">
                        <div
                          className="h-full rounded bg-purple-500"
                          style={{ width: `${Math.min(100, st.mem_percent)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-600">
                        {fmtBytes(st.mem_usage)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {c.Ports.map((p, i) => (
                    <span
                      key={i}
                      className="mr-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs"
                    >
                      {p.PublicPort
                        ? `${p.IP || '0.0.0.0'}:${p.PublicPort}→${p.PrivatePort}/${p.Type}`
                        : `${p.PrivatePort}/${p.Type}`}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(containerTags[c.Id] || []).map((t) => (
                      <span key={t} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">{t}</span>
                    ))}
                    <button
                      onClick={async () => {
                        const input = await promptInline('Tags (comma-separated):')
                        if (input === null) return
                        const tags = input.split(',').map(s => s.trim()).filter(Boolean)
                        await api.tags.set(c.Id, tags)
                        setContainerTags(prev => ({ ...prev, [c.Id]: tags }))
                      }}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-200"
                    >+</button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  {busy === c.Id ? (
                    <Spinner />
                  ) : (
                    <div className="flex justify-end gap-1">
                      {c.State !== 'running' && (
                        <button
                          onClick={() => act(c.Id, 'start')}
                          className={btnAction('bg-green-100 text-green-700')}
                        >
                          Start
                        </button>
                      )}
                      {c.State === 'running' && (
                        <button
                          onClick={() => act(c.Id, 'stop')}
                          className={btnAction('bg-yellow-100 text-yellow-700')}
                        >
                          Stop
                        </button>
                      )}
                      <button
                        onClick={() => act(c.Id, 'restart')}
                        className={btnAction('bg-blue-100 text-blue-700')}
                      >
                        Restart
                      </button>
                      <button
                        onClick={() => act(c.Id, 'remove')}
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
            {containers.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No containers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
      )}

      {tab === 'images' && (
        <>
        <div className="mb-3 flex justify-end">
          <button
            disabled={!!busy}
            onClick={async () => {
              if (!(await confirm('Remove all unused images? This cannot be undone.'))) return
              setBusy('prune')
              try {
                const res = await api.docker.pruneImages()
                const count = res.images_deleted ?? 0
                const space = res.space_reclaimed ?? 0
                const units = ['B', 'KB', 'MB', 'GB', 'TB']
                let sizeStr = '0 B'
                if (space > 0) {
                  const i = Math.min(units.length - 1, Math.floor(Math.log(space) / Math.log(1024)))
                  sizeStr = `${(space / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
                }
                window.alert(`Pruned ${count} image(s), reclaimed ${sizeStr}.`)
                await load()
              } catch (e: any) {
                setError(e.message)
              } finally {
                setBusy('')
              }
            }}
            className="rounded bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-200"
          >
            {busy === 'prune' ? 'Pruning…' : 'Prune unused images'}
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Repository</th>
                <th className="px-4 py-3">Tag</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {images.map((img) => (
                <tr key={img.Id} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    {img.RepoTags?.[0]?.split(':')[0] || '&lt;none&gt;'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {img.RepoTags?.[0]?.split(':')[1] || '&lt;none&gt;'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {img.Id?.slice(7, 19)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{fmtBytes(img.Size)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={!!busy}
                      onClick={async () => {
                        if (!(await confirm(`Delete image ${img.RepoTags?.[0] || img.Id}?`))) return
                        setBusy(img.Id)
                        try {
                          await api.docker.removeImage(img.Id)
                          await load()
                        } catch (e: any) {
                          setError(e.message)
                        } finally {
                          setBusy('')
                        }
                      }}
                      className={btnAction('bg-red-100 text-red-700')}
                    >
                      {busy === img.Id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {images.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No images found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {tab === 'volumes' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Mountpoint</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {volumes.map((v) => (
                <tr key={v.Name} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-900">{v.Name}</td>
                  <td className="px-4 py-3 text-gray-600">{v.Driver}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{v.Mountpoint}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={!!busy}
                      onClick={async () => {
                        if (!(await confirm(`Delete volume ${v.Name}?`))) return
                        setBusy(v.Name)
                        try {
                          await api.docker.removeVolume(v.Name)
                          await load()
                        } catch (e: any) {
                          setError(e.message)
                        } finally {
                          setBusy('')
                        }
                      }}
                      className={btnAction('bg-red-100 text-red-700')}
                    >
                      {busy === v.Name ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {volumes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No volumes found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'networks' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Subnet</th>
                <th className="px-4 py-3">Gateway</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {networks.map((n) => (
                <tr key={n.Id} className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{n.Name}</td>
                  <td className="px-4 py-3 text-gray-600">{n.Driver}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {n.IPAM?.Config?.[0]?.Subnet || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {n.IPAM?.Config?.[0]?.Gateway || '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={!!busy}
                      onClick={async () => {
                        if (!(await confirm(`Delete network ${n.Name}?`))) return
                        setBusy(n.Id)
                        try {
                          await api.docker.removeNetwork(n.Id)
                          await load()
                        } catch (e: any) {
                          setError(e.message)
                        } finally {
                          setBusy('')
                        }
                      }}
                      className={btnAction('bg-red-100 text-red-700')}
                    >
                      {busy === n.Id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {networks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No networks found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateContainerModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            load()
          }}
        />
      )}
      {assistOpen && (
        <AssistModal
          title="AI assistant — Docker"
          placeholder="e.g. create a postgres container called db with port 5432, env POSTGRES_PASSWORD=secret, restart always"
          onClose={() => setAssistOpen(false)}
          apply={async (action, payload) => {
            if (action === 'create-docker') {
              await api.docker.create(payload)
              await load()
              return
            }
            throw new Error(`Unsupported action: ${action}`)
          }}
        />
      )}
      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onDone={() => {
            setComposeOpen(false)
            load()
          }}
        />
      )}
      {pullOpen && (
        <PullImageModal
          onClose={() => setPullOpen(false)}
          onPulled={() => {
            setPullOpen(false)
          }}
        />
      )}
      {logsId && (
        <Modal title={`Logs — ${containers.find((c) => c.Id === logsId)?.Names[0]?.replace(/^\//, '') || logsId.slice(0, 12)}`} onClose={() => setLogsId(null)}>
          <div className="mb-3 flex items-center gap-2">
            <button onClick={() => openLogs(logsId)} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300">Refresh</button>
            <select onChange={async (e) => {
              const tail = e.target.value
              setLogs('')
              try { setLogs(await api.docker.logs(logsId, tail)) } catch {}
            }} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
              <option value="200">Last 200 lines</option>
              <option value="500">Last 500 lines</option>
              <option value="1000">Last 1000 lines</option>
            </select>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-900 p-4 font-mono text-xs leading-relaxed text-green-300">
            {logs || 'Loading...'}
          </pre>
        </Modal>
      )}
      {graphsFor && (
        <LiveGraphsModal
          title={`Live graphs — ${containers.find((c) => c.Id === graphsFor)?.Names[0]?.replace(/^\//, '') || graphsFor.slice(0, 12)}`}
          kind="Docker"
          historyId={graphsFor}
          onClose={() => setGraphsFor(null)}
          sample={async () => {
            const list = await api.docker.stats()
            const s = list.find((x: any) => x.id === graphsFor)
            if (!s) return null
            return {
              cpu: s.cpu_percent || 0,
              mem: s.mem_percent || 0,
              memUsage: s.mem_usage || 0,
              memLimit: s.mem_limit || 0,
              status: 'running',
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

function CreateContainerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [image, setImage] = useState('')
  const [ports, setPorts] = useState('')
  const [env, setEnv] = useState('')
  const [restart, setRestart] = useState('unless-stopped')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError('')
    try {
      // Auto-pull the image if it's not local (Docker Hub reference).
      if (image.includes(':') || image.includes('/')) {
        try {
          await api.docker.pullImage(image)
        } catch {
          // Image may already exist or pull failed — let create try anyway.
        }
      }
      await api.docker.create({
        name: name || undefined,
        image,
        ports: ports.split(',').map((p) => p.trim()).filter(Boolean),
        env: env.split('\n').map((e) => e.trim()).filter(Boolean),
        restart,
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
      title="Create container"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Create container"
      steps={[
        {
          label: 'Image',
          valid: image.trim() !== '',
          body: (
            <div className="space-y-3">
              <Field label="Image *">
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="nginx:latest"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Any image from Docker Hub or a registry, e.g.{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">nginx:latest</code>,{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">postgres:16</code>,{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">ghcr.io/org/app:1.0</code>
                </p>
              </Field>
              <Field label="Name (optional)">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-app"
                  className={inputCls}
                />
              </Field>
            </div>
          ),
        },
        {
          label: 'Config',
          body: (
            <div className="space-y-3">
              <Field label="Ports (host:container, comma separated)">
                <input
                  value={ports}
                  onChange={(e) => setPorts(e.target.value)}
                  placeholder="8080:80, 443:443"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Maps container ports to the host so you can reach the app from your PC.
                </p>
              </Field>
              <Field label="Environment (KEY=value per line)">
                <textarea
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  rows={3}
                  placeholder="TZ=UTC"
                  className={inputCls}
                />
              </Field>
              <Field label="Restart policy">
                <select
                  value={restart}
                  onChange={(e) => setRestart(e.target.value)}
                  className={inputCls}
                >
                  <option value="no">no</option>
                  <option value="always">always</option>
                  <option value="unless-stopped">unless-stopped</option>
                  <option value="on-failure">on-failure</option>
                </select>
              </Field>
            </div>
          ),
        },
        {
          label: 'Review',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Image" v={image || '—'} />
              <ReviewRow k="Name" v={name || '(auto)'} />
              <ReviewRow k="Ports" v={ports || '—'} />
              <ReviewRow k="Environment" v={env ? env.split('\n').filter(Boolean).join(', ') : '—'} />
              <ReviewRow k="Restart" v={restart} />
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

function ComposeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [yaml, setYaml] = useState('')
  const [dir, setDir] = useState('/tmp')
  const [deployName, setDeployName] = useState('lxddash-deploy')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function deploy() {
    if (!yaml.trim()) { setError('YAML is required'); return }
    setBusy('deploy'); setError(''); setOutput('')
    try {
      const res = await api.docker.composeDeploy(yaml, deployName)
      setOutput(res.output || 'Deployed successfully')
      onDone()
    } catch (e: any) { setError(e.message) } finally { setBusy('') }
  }

  async function runDir(action: 'up' | 'down' | 'pull' | 'ps') {
    if (!dir) { setError('Directory is required'); return }
    setBusy(action); setError(''); setOutput('')
    try {
      const res = await api.docker.compose(action, dir)
      setOutput(res.output || '(no output)')
      if (action === 'up' || action === 'down') onDone()
    } catch (e: any) { setError(e.message) } finally { setBusy('') }
  }

  return (
    <Modal title="Docker Compose" onClose={onClose}>
      <div className="space-y-3">
        {/* YAML editor tab */}
        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-medium text-gray-600">Compose YAML</div>
          <textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            placeholder={'version: "3"\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"'}
            className="w-full rounded border border-gray-300 bg-white p-2 font-mono text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
            rows={10}
            spellCheck={false}
          />
          <div className="mt-2 flex items-center gap-2">
            <input value={deployName} onChange={e => setDeployName(e.target.value)} placeholder="project name" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
            <button onClick={deploy} disabled={!!busy} className={btnAction('bg-green-100 text-green-700')}>
              {busy === 'deploy' ? '… Deploying' : 'Deploy'}
            </button>
          </div>
        </div>

        {/* Directory-based tab */}
        <div className="border-t border-gray-200 pt-3">
          <div className="mb-2 text-xs font-medium text-gray-600">Or use existing project directory</div>
          <div className="flex items-center gap-2">
            <input value={dir} onChange={e => setDir(e.target.value)} placeholder="/opt/my-app" className={`${inputCls} flex-1`} />
            <button onClick={() => runDir('up')} disabled={!!busy} className={btnAction('bg-green-100 text-green-700')}>{busy === 'up' ? '…' : 'Up'}</button>
            <button onClick={() => runDir('down')} disabled={!!busy} className={btnAction('bg-red-100 text-red-700')}>{busy === 'down' ? '…' : 'Down'}</button>
            <button onClick={() => runDir('ps')} disabled={!!busy} className={btnAction('bg-gray-100 text-gray-600')}>{busy === 'ps' ? '…' : 'PS'}</button>
          </div>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
        {output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/50 p-3 text-xs text-green-300">{output}</pre>}
        <div className="flex justify-end pt-2"><button onClick={onClose} className={btnGhost}>Close</button></div>
      </div>
    </Modal>
  )
}

function PullImageModal({ onClose, onPulled }: { onClose: () => void; onPulled: () => void }) {
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [task, setTask] = useState<any>(null)

  async function submit() {
    if (!ref) return
    setBusy(true)
    setError('')
    try {
      const t = await api.docker.pullImage(ref)
      setTaskId(t.id)
      setTask(t)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Poll pull progress once started; close + refresh when done.
  useEffect(() => {
    if (!taskId) return
    const iv = setInterval(async () => {
      try {
        const t = await api.docker.pullStatus(taskId)
        setTask(t)
        if (t.status === 'done') {
          clearInterval(iv)
          onPulled()
        } else if (t.status === 'failed') {
          clearInterval(iv)
          setError(t.error || t.message || 'pull failed')
        }
      } catch { /* keep polling */ }
    }, 1000)
    return () => clearInterval(iv)
  }, [taskId, onPulled])

  if (taskId) {
    return (
      <Modal title={`Pulling ${ref}`} onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{error ? 'Failed' : task?.message || 'starting…'}</span>
            <span className="font-medium text-gray-900">{(task?.progress || 0).toFixed(0)}%</span>
          </div>
          <ProgressBar percent={task?.progress || 0} color={error ? 'bg-red-400' : 'bg-blue-500'} />
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            {error && (
              <button onClick={() => { setTaskId(''); setTask(null); setError('') }} className={btnGhost}>
                Back
              </button>
            )}
            <button onClick={onClose} className={btnGhost}>
              {error ? 'Close' : 'Run in background'}
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Wizard
      title="Pull Docker image"
      onClose={onClose}
      onFinish={submit}
      busy={busy}
      finishLabel="Pull image"
      steps={[
        {
          label: 'Pick image',
          valid: ref.trim() !== '',
          body: (
            <div className="space-y-3">
              <Field label="Popular images">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setRef(e.target.value)
                  }}
                  className={inputCls}
                >
                  <option value="">— pick an image —</option>
                  {POPULAR_DOCKER_IMAGES.map((img) => (
                    <option key={img.ref} value={img.ref}>
                      {img.label} ({img.ref})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Or type a custom reference *">
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="nginx:latest"
                  className={inputCls}
                />
              </Field>
            </div>
          ),
        },
        {
          label: 'Confirm',
          body: (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <ReviewRow k="Image" v={ref || '—'} />
              <p className="text-xs text-gray-500">
                Pulls the image from the registry. You can then create containers from it.
              </p>
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

// POPULAR_DOCKER_IMAGES is a curated list of common Docker images.
const POPULAR_DOCKER_IMAGES: { label: string; ref: string }[] = [
  { label: 'Nginx (web server)', ref: 'nginx:latest' },
  { label: 'Nginx 1.27 (stable)', ref: 'nginx:1.27' },
  { label: 'Apache HTTPD', ref: 'httpd:latest' },
  { label: 'Caddy (web server)', ref: 'caddy:latest' },
  { label: 'PostgreSQL 16', ref: 'postgres:16' },
  { label: 'PostgreSQL 17', ref: 'postgres:17' },
  { label: 'MySQL 8', ref: 'mysql:8' },
  { label: 'MariaDB 11', ref: 'mariadb:11' },
  { label: 'Redis 7', ref: 'redis:7' },
  { label: 'MongoDB 7', ref: 'mongo:7' },
  { label: 'Node.js 22 (LTS)', ref: 'node:22' },
  { label: 'Node.js 20 (LTS)', ref: 'node:20' },
  { label: 'Python 3.12', ref: 'python:3.12' },
  { label: 'Python 3.11', ref: 'python:3.11' },
  { label: 'Ubuntu 24.04', ref: 'ubuntu:24.04' },
  { label: 'Debian 12', ref: 'debian:12' },
  { label: 'Alpine 3.20', ref: 'alpine:3.20' },
  { label: 'Portainer (Docker UI)', ref: 'portainer/portainer-ce:latest' },
  { label: 'Grafana (dashboards)', ref: 'grafana/grafana:latest' },
  { label: 'Prometheus (metrics)', ref: 'prom/prometheus:latest' },
  { label: 'Uptime Kuma (monitoring)', ref: 'louislam/uptime-kuma:1' },
  { label: 'Home Assistant', ref: 'ghcr.io/home-assistant/home-assistant:stable' },
  { label: 'Nextcloud', ref: 'nextcloud:latest' },
  { label: 'Jellyfin (media)', ref: 'lscr.io/linuxserver/jellyfin:latest' },
  { label: 'Plex (media)', ref: 'plexinc/pms-docker:latest' },
  { label: 'Pi-hole (ad blocking)', ref: 'pihole/pihole:latest' },
  { label: 'AdGuard Home', ref: 'adguard/adguardhome:latest' },
  { label: 'OpenVPN', ref: 'kylemanna/openvpn:latest' },
  { label: 'WireGuard', ref: 'linuxserver/wireguard:latest' },
  { label: 'MinIO (S3 storage)', ref: 'minio/minio:latest' },
]