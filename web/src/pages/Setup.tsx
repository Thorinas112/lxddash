import { FormEvent, useState } from 'react'
import { api, setToken } from '../api/client'
import { btnPrimary, inputCls } from '../components/ui'

export default function Setup() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const { token } = await api.auth.setup(username, password)
      setToken(token)
      window.location.reload()
    } catch (err: any) {
      setError(err.message || 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-panel3">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-xl"
      >
        <h1 className="text-2xl font-bold text-gray-900">
          <span className="text-blue-600">LXD</span> Dash
        </h1>
        <p className="mt-1 text-sm text-gray-500">Welcome! Create your admin account.</p>
        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
              Admin username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputCls}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
            />
          </div>
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
          <button disabled={loading} className={btnPrimary + ' w-full'}>
            {loading ? 'Creating account…' : 'Create admin account'}
          </button>
        </div>
      </form>
    </div>
  )
}