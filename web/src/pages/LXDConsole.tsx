import { useParams, useNavigate } from 'react-router-dom'
import TerminalView from '../components/TerminalView'

export default function LXDConsole({ isPopup = false }: { isPopup?: boolean }) {
  const { name } = useParams()
  const navigate = useNavigate()
  if (!name) return null

  if (isPopup) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>LXD Console — {name}</span>
          <button
            onClick={() => window.close()}
            style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
          >
            Close
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TerminalView
            wsPath={`/api/lxd/instances/${encodeURIComponent(name)}/exec`}
            title={`LXD Console — ${name}`}
          />
        </div>
      </div>
    )
  }

  return (
    <TerminalView
      wsPath={`/api/lxd/instances/${encodeURIComponent(name)}/exec`}
      title={`LXD Console — ${name}`}
      onClose={() => navigate('/lxd')}
    />
  )
}