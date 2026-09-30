import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { api, clearToken } from '../api/client'
import {
  IconArchive,
  IconBot,
  IconBox,
  IconChart,
  IconCog,
  IconCpu,
  IconDashboard,
  IconDatabase,
  IconGlobe,
  IconImage,
  IconLayers,
  IconList,
  IconLogout,
  IconMonitor,
  IconRefresh,
  IconSearch,
  IconShield,
  IconTerminal,
} from './icons'

// match patterns: parent routes stay highlighted for their child routes
const nav = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/docker', label: 'Docker', icon: IconBox, match: /^\/docker(\/|$)/ },
  { to: '/lxd', label: 'LXD', icon: IconLayers, match: /^\/lxd(\/|$)/ },
  { to: '/lxd/images', label: 'Images', icon: IconImage },
  { to: '/lxd/profiles', label: 'Profiles', icon: IconList },
  { to: '/lxd/storage', label: 'Storage', icon: IconDatabase },
  { to: '/lxd/networks', label: 'Networks', icon: IconGlobe },
  { to: '/lxd/firewall', label: 'Firewall', icon: IconShield },
  { to: '/vms', label: 'VMs', icon: IconMonitor, match: /^\/vms(\/|$)/ },
  { to: '/proxmox', label: 'Proxmox', icon: IconRefresh },
  { to: '/activity', label: 'Activity', icon: IconList },
  { to: '/backups', label: 'Backups', icon: IconArchive },
  { to: '/metrics', label: 'Metrics', icon: IconChart },
  { to: '/resources', label: 'Resources', icon: IconCpu },
  { to: '/systemd', label: 'Services', icon: IconCog },
  { to: '/llm', label: 'LLM', icon: IconBot },
  { to: '/terminal', label: 'Host Terminal', icon: IconTerminal },
  { to: '/settings', label: 'Settings', icon: IconCog },
]

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [runningJobs, setRunningJobs] = useState(0)
  const [updateCount, setUpdateCount] = useState(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const [dark, setDark] = useState(() => localStorage.getItem('lxddash-theme') === 'dark')

  // Global search with debounce.
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        setResults(await api.search(query))
      } catch {
        setResults([])
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  // Close the search dropdown when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Apply dark mode class to body on mount and when toggled.
  useEffect(() => {
    document.body.classList.toggle('dark', dark)
    localStorage.setItem('lxddash-theme', dark ? 'dark' : 'light')
  }, [dark])

  // Ctrl+K focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.querySelector('input')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const typeIcon: Record<string, any> = {
    docker: IconBox,
    lxd: IconLayers,
    vm: IconMonitor,
    image: IconImage,
  }

  function go(link: string) {
    setSearchOpen(false)
    setQuery('')
    navigate(link)
  }

  // Poll backup job status so the nav shows a live "running" badge.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const jobs = await api.backups.jobs()
        if (!cancelled) setRunningJobs(jobs.filter((j: any) => j.running).length)
      } catch {
        /* ignore */
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // Poll for available OS updates so the sidebar shows a badge.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const u = await api.updates.status()
        if (!cancelled) setUpdateCount(u?.available ? u.count || 0 : 0)
      } catch {
        /* ignore */
      }
    }
    check()
    const t = setInterval(check, 60000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <div className="flex h-screen bg-panel3 text-gray-800">
      <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-sidebar bg-sidebar">
        <div className="border-b border-white/10 px-4 py-4">
          <div className="text-base font-semibold tracking-tight text-white">
            LXD <span className="text-blue-400">Dash</span>
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">Server management</div>
        </div>
        <div ref={searchRef} className="relative border-b border-white/10 p-3">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-500" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search…"
              className="w-full rounded-md border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm text-white placeholder-gray-500 focus:border-blue-400 focus:outline-none"
            />
          </div>
          {searchOpen && query.trim() && (
            <div className="absolute left-3 right-3 top-full z-50 mt-1 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl">
              {results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-gray-500">No matches</p>
              ) : (
                results.map((r, i) => {
                  const TIcon = typeIcon[r.type]
                  return (
                    <button
                      key={`${r.type}-${r.id}-${i}`}
                      onClick={() => go(r.link)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100"
                    >
                      {TIcon ? <TIcon className="h-4 w-4 shrink-0 text-gray-400" /> : <span className="h-4 w-4" />}
                      <span className="flex-1 truncate text-gray-900">{r.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          r.running
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {r.status}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {nav.map((n) => {
            // Determine active: use custom match regex if provided, otherwise NavLink's built-in
            const isActive = n.match
              ? n.match.test(location.pathname)
              : location.pathname === n.to || (n.to !== '/' && location.pathname.startsWith(n.to + '/'))
            return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/' || !n.match}
              className={
                `flex items-center gap-3 px-4 py-2 text-[13px] ${
                  isActive
                    ? 'border-r-2 border-blue-400 bg-blue-600/20 text-blue-300'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`
              }
            >
              <n.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{n.label}</span>
              {n.to === '/backups' && runningJobs > 0 && (
                <span className="ml-auto flex items-center gap-1 rounded bg-amber-600/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  {runningJobs}
                </span>
              )}
              {n.to === '/settings' && updateCount > 0 && (
                <span className="ml-auto flex items-center gap-1 rounded bg-amber-600/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                  {updateCount}
                </span>
              )}
            </NavLink>
            )
          })}
        </nav>
        <button
          onClick={() => {
            clearToken()
            navigate('/')
          }}
          className="m-3 flex shrink-0 items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-gray-400 hover:bg-red-900/30 hover:text-red-300"
        >
          <IconLogout className="h-4 w-4" />
          Log out
        </button>
      </aside>
      <main className="flex flex-1 flex-col overflow-auto">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-2">
          <div />
          <button
            onClick={() => setDark((d) => !d)}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </main>
    </div>
  )
}