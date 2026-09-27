import { useParams, useNavigate } from 'react-router-dom'
import TerminalView from '../components/TerminalView'

export default function VMConsole() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  if (!uuid) return null
  return (
    <TerminalView
      wsPath={`/api/vms/${encodeURIComponent(uuid)}/console`}
      title="VM Serial Console"
      onClose={() => navigate('/vms')}
    />
  )
}