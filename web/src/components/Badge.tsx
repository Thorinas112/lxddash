const colors: Record<string, { dot: string; text: string }> = {
  running: { dot: 'bg-green-500', text: 'text-green-700' },
  started: { dot: 'bg-green-500', text: 'text-green-700' },
  done: { dot: 'bg-green-500', text: 'text-green-700' },
  stopped: { dot: 'bg-red-500', text: 'text-red-700' },
  exited: { dot: 'bg-red-500', text: 'text-red-700' },
  failed: { dot: 'bg-red-500', text: 'text-red-700' },
  paused: { dot: 'bg-yellow-500', text: 'text-yellow-700' },
  restarting: { dot: 'bg-yellow-500', text: 'text-yellow-700' },
  created: { dot: 'bg-gray-400', text: 'text-gray-600' },
  'shutting-down': { dot: 'bg-yellow-500', text: 'text-yellow-700' },
}

export default function Badge({ status }: { status: string }) {
  const c = colors[status] || { dot: 'bg-gray-400', text: 'text-gray-600' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {status}
    </span>
  )
}