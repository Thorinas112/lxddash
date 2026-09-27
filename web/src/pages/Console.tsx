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
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">VNC Console</h1>
        <a href="/vms" className="text-sm text-blue-600 hover:underline">
          ← Back to VMs
        </a>
      </div>
      <div className="flex-1 overflow-hidden rounded-lg border border-gray-200 bg-black">
        <div ref={ref} className="h-full w-full" />
      </div>
    </div>
  )
}