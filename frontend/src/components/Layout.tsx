import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import styles from './Layout.module.css'

export default function Layout({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className={styles.wrap}>
      <a href="#main" className="skipLink">跳至主內容</a>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          Stream Downloader
        </Link>
        <nav className={styles.nav}>
          <NavLink to="/" className={({ isActive }) => (isActive ? styles.navActive : '')} end>影片下載</NavLink>
          {token && (
            <>
              <NavLink to="/subtitles" className={({ isActive }) => (isActive ? styles.navActive : '')}>字幕下載</NavLink>
              {user?.is_admin && (
                <NavLink to="/dashboard" className={({ isActive }) => (isActive ? styles.navActive : '')}>管理後台</NavLink>
              )}
            </>
          )}
        </nav>
        <div className={styles.user}>
          {token && user ? (
            <>
              <span className={styles.username}>{user.username}</span>
              <button type="button" className={styles.btnGhost} onClick={handleLogout} aria-label="登出">
                登出
              </button>
            </>
          ) : (
            <Link to="/login" className={styles.btnPrimary}>
              登入 / 加入會員
            </Link>
          )}
        </div>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>{children}</main>
      <footer className={styles.footer}>
        <p>下載內容僅供個人使用，請遵守各平台服務條款與著作權法。</p>
      </footer>
    </div>
  )
}
