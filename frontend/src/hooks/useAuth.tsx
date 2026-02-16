import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { api } from '../api/client'

const TOKEN_KEY = 'stream_dl_token'

type User = { id: number; email: string; username: string; is_admin: boolean; created_at: string } | null

type AuthState = {
  token: string | null
  user: User
  loading: boolean
  setToken: (t: string | null) => void
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User>(null)
  const [loading, setLoading] = useState(true)

  const setToken = useCallback((t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
    setTokenState(t)
    if (!t) setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    if (!token) {
      setUser(null)
      return
    }
    try {
      const u = await api.me()
      setUser(u)
    } catch {
      setToken(null)
    } finally {
      setLoading(false)
    }
  }, [token, setToken])

  useEffect(() => {
    if (token) refreshUser()
    else {
      setUser(null)
      setLoading(false)
    }
  }, [token, refreshUser])

  const logout = useCallback(() => setToken(null), [setToken])

  return (
    <AuthContext.Provider
      value={{ token, user, loading, setToken, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
