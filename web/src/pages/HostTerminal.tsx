import { useNavigate } from 'react-router-dom'
import TerminalView from '../components/TerminalView'

export default function HostTerminal() {
  const navigate = useNavigate()
  return (
    <TerminalView
      wsPath="/api/host/terminal"
      title="Host Terminal"
      onClose={() => navigate('/')}
    />
  )
}