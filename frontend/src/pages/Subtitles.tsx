import { useState, useEffect, useRef } from 'react'
import { api, getToken } from '../api/client'
import styles from './Subtitles.module.css'

const HISTORY_PAGE_SIZE = 10
const RESULTS_PAGE_SIZE = 5

function CopyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

type SubItem = {
  id: string
  source?: string
  file_id?: number
  release?: string
  language?: string
  download_url?: string
  file_name?: string
  page_url?: string
}

type HistoryItem = { id: number; title: string | null; created_at: string }

export default function Subtitles() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SubItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [resultsPage, setResultsPage] = useState(1)
  const hasSetDefaultQuery = useRef(false)

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    api.downloadsHistory(historyPage, HISTORY_PAGE_SIZE)
      .then((res) => {
        if (!cancelled) {
          setHistory(res.items)
          setHistoryTotal(res.total)
        }
      })
      .catch(() => { if (!cancelled) setHistory([]) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [historyPage])

  // 預設帶入搜尋關鍵字為最新一筆下載的檔名
  useEffect(() => {
    if (hasSetDefaultQuery.current || historyLoading || history.length === 0) return
    const firstTitle = history[0].title
    if (firstTitle && firstTitle.trim()) {
      setQuery(firstTitle.trim())
      hasSetDefaultQuery.current = true
    }
  }, [historyLoading, history])

  const search = async () => {
    setError('')
    const q = query.trim()
    if (!q) {
      setError('請輸入影片檔名或片名')
      return
    }
    setLoading(true)
    setResultsPage(1)
    try {
      const res = await api.subsSearch(q)
      setResults(res.data || [])
      if (!res.data?.length) setError('未找到符合的字幕')
    } catch (e) {
      setError(e instanceof Error ? e.message : '搜尋失敗')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const download = (item: SubItem) => {
    const token = getToken()
    const url = api.subsDownloadUrl(item, 'zht')
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error('下載失敗')
        const disp = r.headers.get('Content-Disposition')
        let name = item.file_name || 'subtitle.srt'
        if (disp) {
          const m = disp.match(/filename="?([^";]+)"?/)
          if (m) name = m[1].trim()
        }
        return r.blob().then((blob) => ({ blob, name }))
      })
      .then(({ blob, name }) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => setError('下載失敗'))
  }

  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))
  const resultsTotalPages = Math.max(1, Math.ceil(results.length / RESULTS_PAGE_SIZE))
  const resultsSlice = results.slice(
    (resultsPage - 1) * RESULTS_PAGE_SIZE,
    resultsPage * RESULTS_PAGE_SIZE
  )

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>字幕下載</h1>
      <p className={styles.hint}>
        輸入影片檔名或片名（可貼上完整檔名，系統會自動擷取關鍵字），搜尋後會列出符合的字幕，點擊即可下載到本機。
      </p>

      <div className={styles.card}>
        <label className={styles.label} htmlFor="subs-query">搜尋關鍵字（影片檔名 / 片名）</label>
        <div className={styles.searchRow}>
          <input
            id="subs-query"
            type="text"
            className={styles.input}
            placeholder="例如：Movie.2024.1080p.mkv 或 電影名稱"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <button type="button" className={styles.btn} onClick={search} disabled={loading}>
            {loading ? '搜尋中…' : '搜尋'}
          </button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {results.length > 0 && (
          <div className={styles.results}>
            <h3>符合的字幕（共 {results.length} 筆）</h3>
            <ul className={styles.list}>
              {resultsSlice.map((item) => (
                <li key={item.id || item.release || String(Math.random())}>
                  <span className={styles.itemName}>{item.release || item.file_name || item.id}</span>
                  {item.language && <span className={styles.lang}>{item.language}</span>}
                  {item.source === 'subtitlecat' && (
                    <span className={styles.sourceBadge} title="Subtitle Cat">Subtitle Cat</span>
                  )}
                  <button
                    type="button"
                    className={styles.dlBtn}
                    onClick={() => download(item)}
                  >
                    下載
                  </button>
                </li>
              ))}
            </ul>
            {results.length > RESULTS_PAGE_SIZE && (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={resultsPage <= 1}
                  onClick={() => setResultsPage((p) => p - 1)}
                >
                  上一頁
                </button>
                <span className={styles.pageInfo}>
                  {resultsPage} / {resultsTotalPages}（共 {results.length} 筆）
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={resultsPage >= resultsTotalPages}
                  onClick={() => setResultsPage((p) => p + 1)}
                >
                  下一頁
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <section className={styles.historySection}>
        <h2 className={styles.historyTitle}>已下載的檔案</h2>
        {historyLoading ? (
          <p className={styles.historyEmpty}>載入中…</p>
        ) : history.length === 0 ? (
          <p className={styles.historyEmpty}>尚無下載紀錄</p>
        ) : (
          <>
            <ul className={styles.historyList}>
              {history.map((item) => (
                <li key={item.id}>
                  <span className={styles.historyName}>{item.title || `(無檔名)`}</span>
                  <span className={styles.historyDate}>
                    {new Date(item.created_at).toLocaleString('zh-TW')}
                  </span>
                  <button
                    type="button"
                    className={styles.copyBtn}
                    title="複製檔名到剪貼簿"
                    aria-label="複製檔名到剪貼簿"
                    onClick={() => {
                      const text = item.title || ''
                      if (text) {
                        navigator.clipboard.writeText(text).then(() => setQuery(text))
                      }
                    }}
                    disabled={!item.title}
                  >
                    <CopyIcon />
                  </button>
                </li>
              ))}
            </ul>
            {historyTotal > HISTORY_PAGE_SIZE && (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={historyPage <= 1}
                  onClick={() => setHistoryPage((p) => p - 1)}
                >
                  上一頁
                </button>
                <span className={styles.pageInfo}>
                  {historyPage} / {totalPages}（共 {historyTotal} 筆）
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={historyPage >= totalPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  下一頁
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
