import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getToken } from '../api/client'

interface Props {
  /** WebSocket endpoint path, e.g. /api/lxd/instances/foo/exec */
  wsPath: string
  title: string
  onClose?: () => void
}

/**
 * Web terminal backed by a WebSocket. Sends terminal input as binary
 * messages and handles {"type":"resize","cols":N,"rows":N} control
 * messages for PTY resizing.
 */
export default function TerminalView({ wsPath, title, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#0d1117', foreground: '#e6edf3' },
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term

    const token = getToken()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}${wsPath}?token=${token}`)
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      term.writeln('\x1b[90m— connected —\x1b[0m')
      term.focus()
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        term.write(ev.data)
      } else {
        term.write(new Uint8Array(ev.data))
      }
    }
    ws.onclose = () => {
      term.writeln('\r\n\x1b[90m— disconnected —\x1b[0m')
    }
    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m— connection error —\x1b[0m')
    }

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
    const resizeObserver = new ResizeObserver(() => {
      fit.fit()
      sendResize()
    })
    resizeObserver.observe(hostRef.current)
    sendResize()

    return () => {
      dataDisposable.dispose()
      resizeObserver.disconnect()
      ws.close()
      term.dispose()
    }
  }, [wsPath])

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {onClose && (
          <button onClick={onClose} className="text-sm text-blue-600 hover:underline">
            ← Back
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden rounded-lg border border-gray-200 bg-[#0d1117]">
        <div ref={hostRef} className="h-full w-full p-2" />
      </div>
    </div>
  )
}