import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import styles from './Home.module.css'

export default function Home() {
  const { token } = useAuth()

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Stream Downloader</h1>
        <p className={styles.tagline}>
          加入會員即可將影片下載到本機，支援 YouTube、missav 及多數網站；並可依檔名搜尋、預覽與下載字幕。
        </p>
        {!token && (
          <Link to="/login" className={styles.cta}>
            登入 / 加入會員
          </Link>
        )}
        {token && (
          <div className={styles.ctaRow}>
            <Link to="/download" className={styles.cta}>
              影片下載
            </Link>
            <Link to="/subtitles" className={styles.ctaSecondary}>
              字幕下載
            </Link>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>操作說明</h2>

        <div className={styles.card}>
          <h3>影片下載</h3>
          <ol>
            <li>在「<Link to={token ? '/download' : '/login'}>影片下載</Link>」頁面貼上影片網址（支援 YouTube、missav 等）。</li>
            <li>點擊開始下載，即時顯示進度；完成時會儲存為 .mkv 至瀏覽器下載位置（可選擇存放目錄）。</li>
          </ol>
        </div>

        <div className={styles.card}>
          <h3>字幕下載</h3>
          <ol>
            <li>在「<Link to={token ? '/subtitles' : '/login'}>字幕下載</Link>」頁面輸入影片檔名或片名（可貼上完整檔名，系統會自動擷取關鍵字搜尋）。</li>
            <li>搜尋結果會列出符合的字幕，可預覽檔名與語言。</li>
            <li>選擇要下載的字幕，點擊下載即可儲存到本機。</li>
          </ol>
        </div>

        <p className={styles.note}>
          管理員可使用「管理後台」查看會員與下載紀錄。預設管理員帳號：id <code>admin</code>，密碼 <code>1qaz2wsx</code>。
        </p>
      </section>
    </div>
  )
}
