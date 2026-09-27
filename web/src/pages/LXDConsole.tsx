import { useParams, useNavigate } from 'react-router-dom'
import TerminalView from '../components/TerminalView'

export default function LXDConsole({ isPopup = false }: { isPopup?: boolean }) {
  const { name } = useParams()
  const navigate = useNavigate()
  if (!name) return null

  if (isPopup) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #30363d', color: '#e6edf3', fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#161b22' }}>
          <span style={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}>{name}</span>
          <button
            onClick={() => window.close()}
            style={{ background: '#da3633', border: 'none', color: '#fff', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
          >
            Close
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', padding: '8px 12px' }}>
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