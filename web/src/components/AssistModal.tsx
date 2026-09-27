import { useState } from 'react'
import { api } from '../api/client'
import Modal from './Modal'
import { btnGhost, btnPrimary, inputCls } from './ui'

// AssistModal lets the user describe what they want in plain English
// and uses the local LLM to generate a resource definition. The
// generated payload is shown and can be applied via the `apply`
// callback.
export default function AssistModal({
  title,
  placeholder,
  apply,
  onClose,
}: {
  title: string
  placeholder: string
  apply: (action: string, payload: any) => Promise<void>
  onClose: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<{ action: string; explanation: string; payload: any } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  async function ask() {
    if (!prompt.trim()) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.ollama.assist(prompt))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function doApply() {
    if (!result) return
    setApplying(true)
    setError('')
    try {
      // Normalize common LLM quirks: string arrays like "[8080:80]"
      // or "8080:80, 443:443" become real arrays.
      const payload = normalizePayload(result.payload)
      await apply(result.action, payload)
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Describe what you want in plain English — the local LLM generates the configuration,
          which you can review and apply.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className={`${inputCls} resize-none`}
        />
        <div className="flex justify-end">
          <button onClick={ask} disabled={busy || !prompt.trim()} className={btnPrimary}>
            {busy ? 'Thinking…' : 'Generate'}
          </button>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                {result.action}
              </span>
              <span className="text-xs text-gray-500">{result.explanation}</span>
            </div>
            <pre className="max-h-64 overflow-auto rounded border border-gray-200 bg-gray-900 p-3 font-mono text-xs text-gray-300">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <button onClick={() => setResult(null)} className={btnGhost}>
                Edit prompt
              </button>
              <button onClick={doApply} disabled={applying} className={btnPrimary}>
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// normalizePayload fixes common LLM output quirks so the payload can
// be sent to the API directly.
function normalizePayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload
  const out: any = { ...payload }

  // String arrays: "[8080:80]" or "8080:80, 443:443" -> ["8080:80", "443:443"]
  for (const key of ['ports', 'env', 'tags', 'profiles']) {
    if (typeof out[key] === 'string') {
      const s = out[key].trim()
      const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s
      out[key] = inner
        .split(',')
        .map((x: string) => x.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
  }

  // Numeric strings -> numbers.
  for (const key of ['memory_mb', 'vcpus', 'disk_gb', 'retention', 'port']) {
    if (typeof out[key] === 'string' && out[key].trim() !== '') {
      const n = Number(out[key])
      if (!isNaN(n)) out[key] = n
    }
  }

  // Boolean strings -> booleans.
  for (const key of ['auto_start', 'nat', 'enabled']) {
    if (typeof out[key] === 'string') {
      out[key] = out[key].toLowerCase() === 'true'
    }
  }

  // "config" as a string -> parse JSON.
  if (typeof out.config === 'string' && out.config.trim()) {
    try {
      out.config = JSON.parse(out.config)
    } catch {
      delete out.config
    }
  }

  return out
}