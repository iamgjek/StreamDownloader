import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api } from '../api/client'
import styles from './Login.module.css'

export default function Login() {
  const navigate = useNavigate()
  const { setToken } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const { access_token } = await api.login(email, password)
      setToken(access_token)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '登入失敗')
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) {
      setError('請輸入使用者名稱')
      return
    }
    try {
      const { access_token } = await api.register(email, username.trim(), password)
      setToken(access_token)
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : '註冊失敗')
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>登入 / 加入會員</h1>
      <p className={styles.hint}>
        登入後即可使用影片下載與字幕下載功能。管理員請使用 id <code>admin</code> 登入。
      </p>

      <div className={styles.card}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={tab === 'login' ? styles.tabActive : styles.tab}
            onClick={() => { setTab('login'); setError('') }}
          >
            登入
          </button>
          <button
            type="button"
            className={tab === 'register' ? styles.tabActive : styles.tab}
            onClick={() => { setTab('register'); setError('') }}
          >
            加入會員
          </button>
        </div>

        {tab === 'login' && (
          <form onSubmit={handleLogin} aria-label="登入表單">
            <label className={styles.label} htmlFor="login-email">信箱或使用者名稱</label>
            <input
              id="login-email"
              type="text"
              className={styles.input}
              placeholder="admin 或 you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
            <label className={styles.label} htmlFor="login-password">密碼</label>
            <input
              id="login-password"
              type="password"
              className={styles.input}
              placeholder="密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button type="submit" className={styles.btn}>登入</button>
          </form>
        )}

        {tab === 'register' && (
          <form onSubmit={handleRegister} aria-label="註冊表單">
            <label className={styles.label} htmlFor="reg-email">信箱</label>
            <input
              id="reg-email"
              type="email"
              className={styles.input}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <label className={styles.label} htmlFor="reg-username">使用者名稱</label>
            <input
              id="reg-username"
              type="text"
              className={styles.input}
              placeholder="顯示名稱"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <label className={styles.label} htmlFor="reg-password">密碼</label>
            <input
              id="reg-password"
              type="password"
              className={styles.input}
              placeholder="密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <button type="submit" className={styles.btn}>註冊並登入</button>
          </form>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>

      <p className={styles.back}>
        <Link to="/">← 返回影片下載</Link>
      </p>
    </div>
  )
}
