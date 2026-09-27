import { useParams, useNavigate } from 'react-router-dom'
import TerminalView from '../components/TerminalView'

export default function LXDConsole() {
  const { name } = useParams()
  const navigate = useNavigate()
  if (!name) return null
  return (
    <TerminalView
      wsPath={`/api/lxd/instances/${encodeURIComponent(name)}/exec`}
      title={`LXD Console — ${name}`}
      onClose={() => navigate('/lxd')}
    />
  )
}