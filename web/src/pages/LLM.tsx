import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Modal from '../components/Modal'
import { btnAction, btnGhost, btnPrimary, inputCls } from '../components/ui'

interface Model {
  name: string
  size: number
  modified_at: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function LLM() {
  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pullOpen, setPullOpen] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const ms = await api.ollama.models()
      setModels(ms)
      if (!model && ms.length > 0) setModel(ms[0].name)
    } catch (e: any) {
      setError(e.message)
    }
    try {
      setStats(await api.ollama.stats())
    } catch {
      /* ignore */
    }
  }, [model])

  useEffect(() => {
    load()
    const t = setInterval(() => {
      api.ollama.stats().then(setStats).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || !model || busy) return
    const next: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setError('')
    const assistant: Msg = { role: 'assistant', content: '' }
    setMessages([...next, assistant])
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await api.ollama.chatStream(
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...next.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
        (chunk) => {
          assistant.content += chunk
          setMessages([...next, { ...assistant }])
        },
        ac.signal,
      )
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  function clearChat() {
    setMessages([])
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">LLM (Ollama)</h1>
        <div className="flex items-center gap-2">
          {stats && (
            <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
              CPU {stats.cpu_percent?.toFixed(1) ?? '—'}% · RAM{' '}
              {stats.memory_bytes ? fmtBytes(stats.memory_bytes) : '—'}
            </span>
          )}
          <button onClick={() => setPullOpen(true)} className={btnGhost}>
            Pull model
          </button>
          <button onClick={clearChat} className={btnGhost}>
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-gray-500">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={`${inputCls} w-64`}
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({fmtBytes(m.size)})
            </option>
          ))}
        </select>
        <label className="ml-4 text-xs uppercase tracking-wide text-gray-500">System</label>
        <input
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          className={`${inputCls} flex-1`}
          placeholder="System prompt…"
        />
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Start a conversation with your local LLM
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.content || (busy && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder="Message the LLM… (Enter to send, Shift+Enter for newline)"
          className={inputCls}
        />
        {busy ? (
          <button onClick={stop} className={btnAction('bg-red-100 text-red-700')}>
            Stop
          </button>
        ) : (
          <button onClick={send} disabled={!input.trim() || !model} className={btnPrimary}>
            Send
          </button>
        )}
      </div>

      {pullOpen && (
        <PullModelModal
          onClose={() => setPullOpen(false)}
          onPulled={() => {
            setPullOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function PullModelModal({ onClose, onPulled }: { onClose: () => void; onPulled: () => void }) {
  const [name, setName] = useState('llama3.2:1b')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name) return
    setBusy(true)
    setError('')
    try {
      await api.ollama.pull(name)
      onPulled()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Pull Ollama model" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="llama3.2:1b"
          className={inputCls}
        />
        <p className="text-xs text-gray-500">
          Examples: llama3.2:1b, llama3.2:3b, llama3.1:8b, qwen2.5:7b, mistral:7b
        </p>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !name} className={btnPrimary}>
            {busy ? 'Pulling…' : 'Pull'}
          </button>
        </div>
      </div>
    </Modal>
  )
}