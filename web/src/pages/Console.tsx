import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import RFB from '@novnc/novnc'
import { getToken } from '../api/client'

export default function Console() {
  const { uuid } = useParams()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !uuid) return
    const token = getToken()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/vms/${uuid}/vnc?token=${token}`
    const rfb = new RFB(ref.current, url)
    rfb.scaleViewport = true
    return () => rfb.disconnect()
  }, [uuid])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#000' }}>
      <div className="flex items-center justify-between" style={{ padding: '8px 16px', background: '#1a1a2e', color: '#e0e0e0' }}>
        <h1 style={{ fontSize: 14, fontWeight: 600 }}>VNC Console</h1>
        <a href="/vms" style={{ fontSize: 12, color: '#60a5fa' }}>Back to VMs</a>
      </div>
      <div ref={ref} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}