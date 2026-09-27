import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Dashboard from './pages/Dashboard'
import Docker from './pages/Docker'
import Images from './pages/Images'
import LXD from './pages/LXD'
import Profiles from './pages/Profiles'
import Storage from './pages/Storage'
import Networks from './pages/Networks'
import Firewall from './pages/Firewall'
import VMs from './pages/VMs'
import Console from './pages/Console'
import LXDConsole from './pages/LXDConsole'
import LXDInstance from './pages/LXDInstance'
import VMConsole from './pages/VMConsole'
import HostTerminal from './pages/HostTerminal'
import LLM from './pages/LLM'
import Proxmox from './pages/Proxmox'
import Activity from './pages/Activity'
import Backups from './pages/Backups'
import Metrics from './pages/Metrics'
import Resources from './pages/Resources'
import Systemd from './pages/Systemd'
import Settings from './pages/Settings'
import { api } from './api/client'
import { useAuth } from './hooks/useAuth'

export default function App() {
  const { token } = useAuth()
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)

  useEffect(() => {
    api.auth
      .status()
      .then((s) => setSetupRequired(s.setup_required))
      .catch(() => setSetupRequired(false))
  }, [])

  if (setupRequired === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-panel3 text-gray-500">
        Loading…
      </div>
    )
  }

  if (setupRequired) return <Setup />
  if (!token) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/docker" element={<Docker />} />
        <Route path="/lxd" element={<LXD />} />
        <Route path="/lxd/images" element={<Images />} />
        <Route path="/lxd/profiles" element={<Profiles />} />
        <Route path="/lxd/storage" element={<Storage />} />
        <Route path="/lxd/networks" element={<Networks />} />
        <Route path="/lxd/firewall" element={<Firewall />} />
        <Route path="/lxd/:name/console" element={<LXDConsole isPopup={false} />} />
        <Route path="/lxd/:name/console-popup" element={<LXDConsole isPopup={true} />} />
        <Route path="/lxd/:name" element={<LXDInstance />} />
        <Route path="/vms" element={<VMs />} />
        <Route path="/vms/:uuid/console" element={<Console />} />
        <Route path="/vms/:uuid/terminal" element={<VMConsole />} />
        <Route path="/proxmox" element={<Proxmox />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/backups" element={<Backups />} />
        <Route path="/metrics" element={<Metrics />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/systemd" element={<Systemd />} />
        <Route path="/terminal" element={<HostTerminal />} />
        <Route path="/llm" element={<LLM />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}