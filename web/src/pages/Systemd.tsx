import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import Badge from '../components/Badge'
import Spinner from '../components/Spinner'

export default function Systemd() {
  const [services, setServices] = useState<any[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setServices(await api.systemd.services())
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  async function act(name: string, action: string) {
    setBusy(`${name}:${action}`)
    try {
      await api.systemd.action(name, action)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const q = filter.toLowerCase()
  const shown = services.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.desc || '').toLowerCase().includes(q),
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Systemd Services</h1>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter services…"
          className="w-64 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
        />
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
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((s) => (
              <tr key={s.name} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-900">{s.name}</td>
                <td className="px-4 py-3">
                  <Badge status={s.running ? 'Running' : 'Stopped'} />
                </td>
                <td className="px-4 py-3 text-gray-600">{s.enabled ? 'yes' : 'no'}</td>
                <td className="max-w-md truncate px-4 py-3 text-gray-600">{s.desc}</td>
                <td className="px-4 py-3 text-right">
                  {busy === `${s.name}:${'start'}` || busy === `${s.name}:${'stop'}` ? (
                    <Spinner />
                  ) : (
                    <div className="flex justify-end gap-1">
                      {!s.running && (
                        <button
                          onClick={() => act(s.name, 'start')}
                          className="rounded bg-green-100 px-2 py-1 text-xs text-green-700 hover:bg-green-200"
                        >
                          Start
                        </button>
                      )}
                      {s.running && (
                        <button
                          onClick={() => act(s.name, 'stop')}
                          className="rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-200"
                        >
                          Stop
                        </button>
                      )}
                      <button
                        onClick={() => act(s.name, 'restart')}
                        className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                      >
                        Restart
                      </button>
                      <button
                        onClick={() => act(s.name, s.enabled ? 'disable' : 'enable')}
                        className="rounded bg-purple-100 px-2 py-1 text-xs text-purple-700 hover:bg-purple-200"
                      >
                        {s.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No services found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}