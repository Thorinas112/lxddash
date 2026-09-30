import { ReactNode, useEffect, useState } from 'react'

let resolveConfirm: ((value: boolean) => void) | null = null
let resolvePrompt: ((value: string | null) => void) | null = null

/**
 * Show a confirmation dialog. Returns a promise that resolves to true/false.
 * Works like window.confirm() but uses inline UI instead of browser popups.
 */
export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    resolveConfirm = resolve
    window.dispatchEvent(new CustomEvent('confirm-dialog', { detail: message }))
  })
}

/**
 * Show a prompt dialog. Returns a promise with the entered string or null.
 * Works like window.prompt() but uses inline UI instead of browser popups.
 */
export function promptInline(message: string): Promise<string | null> {
  return new Promise((resolve) => {
    resolvePrompt = resolve
    window.dispatchEvent(new CustomEvent('prompt-dialog', { detail: message }))
  })
}

/**
 * Provider that renders the inline confirmation and prompt dialogs.
 * Mount this once near the app root.
 */
export default function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [confirmMsg, setConfirmMsg] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [promptMsg, setPromptMsg] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptValue, setPromptValue] = useState('')

  useEffect(() => {
    const onConfirm = (e: Event) => {
      setConfirmMsg((e as CustomEvent).detail)
      setConfirmOpen(true)
    }
    const onPrompt = (e: Event) => {
      setPromptMsg((e as CustomEvent).detail)
      setPromptValue('')
      setPromptOpen(true)
    }
    window.addEventListener('confirm-dialog', onConfirm)
    window.addEventListener('prompt-dialog', onPrompt)
    return () => {
      window.removeEventListener('confirm-dialog', onConfirm)
      window.removeEventListener('prompt-dialog', onPrompt)
    }
  }, [])

  return (
    <>
      {children}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setConfirmOpen(false); resolveConfirm?.(false); resolveConfirm = null }}>
          <div className="mx-4 w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 text-sm text-gray-700">{confirmMsg}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmOpen(false); resolveConfirm?.(false); resolveConfirm = null }} className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => { setConfirmOpen(false); resolveConfirm?.(true); resolveConfirm = null }} className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Confirm</button>
            </div>
          </div>
        </div>
      )}
      {promptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setPromptOpen(false); resolvePrompt?.(null); resolvePrompt = null }}>
          <div className="mx-4 w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm text-gray-700">{promptMsg}</p>
            <input autoFocus value={promptValue} onChange={(e) => setPromptValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setPromptOpen(false); resolvePrompt?.(promptValue || null); resolvePrompt = null } }} className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setPromptOpen(false); resolvePrompt?.(null); resolvePrompt = null }} className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => { setPromptOpen(false); resolvePrompt?.(promptValue || null); resolvePrompt = null }} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
