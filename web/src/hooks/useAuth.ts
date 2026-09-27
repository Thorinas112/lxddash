import { useEffect, useState } from 'react'
import { getToken } from '../api/client'

export function useAuth() {
  const [token, setToken] = useState<string | null>(getToken())

  useEffect(() => {
    const onStorage = () => setToken(getToken())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { token }
}