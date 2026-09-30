import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import Badge from '../components/Badge'

interface Entry {
  id: number
  time: string
  category: string
  action: string
  target: string
  message: string
  status: string
}

const catColors: Record<string, string> = {
  docker: 'bg-blue-100 text-blue-700',
  lxd: 'bg-green-100 text-green-700',
  vm: 'bg-purple-100 text-purple-700',
  proxmox: 'bg-orange-100 text-orange-700',
  llm: 'bg-pink-100 text-pink-700',
  system: 'bg-gray-100 text-gray-600',
  forward: 'bg-teal-100 text-teal-700',
  host: 'bg-red-100 text-red-700',
  systemd: 'bg-indigo-100 text-indigo-700',
  updates: 'bg-amber-100 text-amber-700',
}

export default function Activity() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setEntries(await api.activity(category, 200))
    } catch (e: any) {
      setError(e.message)
    }
  }, [category])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Activity Log</h1>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="">All categories</option>
          <option value="docker">Docker</option>
          <option value="lxd">LXD</option>
          <option value="vm">VMs</option>
          <option value="proxmox">Proxmox</option>
          <option value="llm">LLM</option>
          <option value="system">System</option>
          <option value="forward">Port forwards</option>
          <option value="host">Host</option>
          <option value="systemd">Systemd</option>
          <option value="updates">Updates</option>
        </select>
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
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map((e) => (
              <tr key={e.id} className="bg-white hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">
                  {new Date(e.time).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-xs ${catColors[e.category] || catColors.system}`}>
                    {e.category}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-700">{e.action}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-900">{e.target}</td>
                <td className="px-4 py-2.5 text-gray-600">{e.message}</td>
                <td className="px-4 py-2.5">
                  <Badge status={e.status} />
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No activity yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}