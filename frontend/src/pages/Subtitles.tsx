import { useState, useEffect, useRef } from 'react'
import { api, getToken } from '../api/client'
import styles from './Subtitles.module.css'
import { trackCtaEvent } from '../analytics/ga'

const RESULTS_PAGE_SIZE = 5
const SUBTITLE_KEYWORD_STORAGE_KEY = 'stream_dl_subtitle_downloaded_keywords_v1'

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

type DownloadedSubtitleKeyword = { keyword: string; downloaded_at: number }

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  )
}

export default function Subtitles() {
  const [query, setQuery] = useState('')
  /** 對應「目前 results 是用哪個關鍵字搜尋出來的」，避免下載時 query 被使用者改掉而寫錯 */
  const [activeSearchKeyword, setActiveSearchKeyword] = useState('')
  const [results, setResults] = useState<SubItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 記錄每筆搜尋結果下載失敗的提示訊息（以 tooltip 形式顯示，避免版面變動） */
  const [downloadHints, setDownloadHints] = useState<Record<string, string>>({})
  const [downloadedSubtitleKeywords, setDownloadedSubtitleKeywords] = useState<DownloadedSubtitleKeyword[]>(() => {
    try {
      if (typeof window === 'undefined') return []
      const raw = localStorage.getItem(SUBTITLE_KEYWORD_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      const cleaned: DownloadedSubtitleKeyword[] = parsed
        .map((x) => x as Partial<DownloadedSubtitleKeyword>)
        .filter((x): x is DownloadedSubtitleKeyword => typeof x.keyword === 'string' && typeof x.downloaded_at === 'number')
      return cleaned.sort((a, b) => b.downloaded_at - a.downloaded_at)
    } catch {
      return []
    }
  })
  const [resultsPage, setResultsPage] = useState(1)
  const hasSetDefaultQuery = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(SUBTITLE_KEYWORD_STORAGE_KEY, JSON.stringify(downloadedSubtitleKeywords))
    } catch {
      // ignore storage errors
    }
  }, [downloadedSubtitleKeywords])

  // 預設帶入搜尋關鍵字為最新一筆下載的字幕關鍵字
  useEffect(() => {
    if (hasSetDefaultQuery.current || downloadedSubtitleKeywords.length === 0) return
    const latestKeyword = downloadedSubtitleKeywords[0].keyword
    if (latestKeyword && latestKeyword.trim()) {
      setQuery(latestKeyword.trim())
      hasSetDefaultQuery.current = true
    }
  }, [downloadedSubtitleKeywords])

  const upsertDownloadedKeyword = (keyword: string) => {
    const cleaned = keyword.trim()
    if (!cleaned) return
    const now = Date.now()
    setDownloadedSubtitleKeywords((prev) => {
      const next = prev.slice()
      const idx = next.findIndex((x) => x.keyword === cleaned)
      if (idx >= 0) {
        next[idx] = { keyword: cleaned, downloaded_at: now }
      } else {
        next.push({ keyword: cleaned, downloaded_at: now })
      }
      // 更新後去重並以「最新下載時間」排序
      next.sort((a, b) => b.downloaded_at - a.downloaded_at)
      // 防呆：確保 keyword 唯一（理論上已保證）
      const deduped: DownloadedSubtitleKeyword[] = []
      const seen = new Set<string>()
      for (const it of next) {
        if (seen.has(it.keyword)) continue
        seen.add(it.keyword)
        deduped.push(it)
      }
      return deduped
    })
  }

  const isSubtitlecatNoDirectLinkHint = (msg: string) => {
    return msg.includes('此頁沒有該語言的直接下載連結') && msg.includes('Subtitle Cat')
  }

  const search = async () => {
    setError('')
    const q = query.trim()
    if (!q) {
      setError('請輸入影片檔名或片名')
      return
    }
    setActiveSearchKeyword(q)
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

  const download = (item: SubItem, keywordFromSearch: string) => {
    const rowId = item.id
    setDownloadHints((prev) => {
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
    const token = getToken()
    const url = api.subsDownloadUrl(item, 'zht', keywordFromSearch)
    const keyword = (keywordFromSearch || '').trim()
    setError('')
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          const msg = (data.detail as string) || r.statusText || '下載失敗'
          throw new Error(msg)
        }
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
        if (keyword) upsertDownloadedKeyword(keyword)
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : '下載失敗'
        if (item.source === 'subtitlecat' && isSubtitlecatNoDirectLinkHint(msg)) {
          // 特定提示改用 tooltip + alert icon 顯示
          setDownloadHints((prev) => ({ ...prev, [rowId]: msg }))
          return
        }
        setError(msg)
      })
  }

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
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              trackCtaEvent({ action: 'subtitles_search', label: `搜尋：${query || ''}`, location: 'search' })
              search()
            }}
            disabled={loading}
          >
            {loading ? '搜尋中…' : '搜尋'}
          </button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {results.length > 0 && (
          <div className={styles.results}>
            <h3>符合的字幕（共 {results.length} 筆）</h3>
            <ul className={styles.list}>
              {resultsSlice.map((item) => (
                <li key={item.id}>
                  <span className={styles.itemName}>{item.release || item.file_name || item.id}</span>
                  {downloadHints[item.id] && (
                    <span
                      className={styles.alertIcon}
                      role="img"
                      aria-label="下載提示"
                      title={downloadHints[item.id]}
                      tabIndex={0}
                    >
                      <AlertIcon />
                    </span>
                  )}
                  {item.language && <span className={styles.lang}>{item.language}</span>}
                  {item.source === 'subtitlecat' && (
                    <span className={styles.sourceBadge} title="Subtitle Cat">Subtitle Cat</span>
                  )}
                  <button
                    type="button"
                    className={styles.dlBtn}
                    onClick={() => {
                      trackCtaEvent({
                        action: 'subtitles_download',
                        label: `下載：${activeSearchKeyword || '未知關鍵字'}`,
                        location: 'results',
                      })
                      download(item, activeSearchKeyword)
                    }}
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
        <h2 className={styles.historyTitle}>下載過的字幕</h2>
        {downloadedSubtitleKeywords.length === 0 ? (
          <p className={styles.historyEmpty}>尚無下載紀錄</p>
        ) : (
          <ul className={styles.historyList}>
            {downloadedSubtitleKeywords.map((it) => (
              <li key={it.keyword}>
                <span
                  className={styles.historyLabel}
                  role="button"
                  tabIndex={0}
                  onClick={() => setQuery(it.keyword)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setQuery(it.keyword)
                  }}
                >
                  {it.keyword}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
