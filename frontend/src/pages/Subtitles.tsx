import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { api, getToken } from '../api/client'
import styles from './Subtitles.module.css'
import { trackCtaEvent } from '../analytics/ga'
import { usePageMeta } from '../hooks/usePageMeta'
import { useJsonLd } from '../hooks/useJsonLd'
import { PAGE_META } from '../seo/pageMeta'
import { buildSubtitlesHomeJsonLd } from '../seo/subtitlesJsonLd'

const RESULTS_PAGE_SIZE = 5
const SUBTITLE_KEYWORD_STORAGE_KEY = 'stream_dl_subtitle_downloaded_keywords_v1'
const TOAST_DURATION_MS = 4500

type LangFilter = 'all' | 'zht' | 'zhs'

type SubItem = {
  id: string
  source?: string
  lang_code?: string
  file_id?: number
  release?: string
  language?: string
  download_url?: string
  file_name?: string
  page_url?: string
}

function getSourceLabel(source?: string): string | null {
  if (source === 'subtitlecat') return 'Subtitle Cat'
  if (source === 'subtitlenexus') return 'Subtitle Nexus'
  if (source === 'avsubtitles') return 'AVSubtitles'
  return null
}

function isRecommendedItem(item: SubItem): boolean {
  return item.lang_code === 'zht' && item.source === 'subtitlecat'
}

function matchesLangFilter(item: SubItem, filter: LangFilter): boolean {
  if (filter === 'all') return true
  const code = item.lang_code || (item.language === '簡中' ? 'zhs' : 'zht')
  return code === filter
}

function FeatureIcon({ type }: { type: 'sources' | 'format' | 'sort' }) {
  if (type === 'sources') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
      </svg>
    )
  }
  if (type === 'format') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h6" />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m3 8 4-4 4 4M7 4v16" />
      <path d="m14 12 4-4 4 4M18 8v12" />
    </svg>
  )
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
  usePageMeta(PAGE_META.subtitles)
  const jsonLd = useMemo(
    () => buildSubtitlesHomeJsonLd(typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  )
  useJsonLd(jsonLd)

  const [query, setQuery] = useState('')
  const [activeSearchKeyword, setActiveSearchKeyword] = useState('')
  const [results, setResults] = useState<SubItem[]>([])
  const [langFilter, setLangFilter] = useState<LangFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string | null>(null)
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
  const hasRunUrlQuery = useRef(false)

  const filteredResults = useMemo(
    () => results.filter((item) => matchesLangFilter(item, langFilter)),
    [results, langFilter],
  )

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    setResultsPage(1)
  }, [langFilter, results.length])

  const syncQueryToUrl = useCallback((q: string) => {
    const url = new URL(window.location.href)
    if (q) {
      url.searchParams.set('q', q)
    } else {
      url.searchParams.delete('q')
    }
    window.history.replaceState(null, '', url)
  }, [])

  const runSearch = useCallback(async (rawQuery: string) => {
    setError('')
    const q = rawQuery.trim()
    if (!q) {
      setError('請輸入影片檔名或片名')
      return
    }
    setActiveSearchKeyword(q)
    setLoading(true)
    setResultsPage(1)
    syncQueryToUrl(q)
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
  }, [syncQueryToUrl])

  useEffect(() => {
    if (hasRunUrlQuery.current) return
    const q = new URLSearchParams(window.location.search).get('q')?.trim()
    if (!q) return
    hasRunUrlQuery.current = true
    setQuery(q)
    runSearch(q)
  }, [runSearch])

  useEffect(() => {
    try {
      localStorage.setItem(SUBTITLE_KEYWORD_STORAGE_KEY, JSON.stringify(downloadedSubtitleKeywords))
    } catch {
      // ignore storage errors
    }
  }, [downloadedSubtitleKeywords])

  useEffect(() => {
    if (hasRunUrlQuery.current) return
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

  const search = () => {
    trackCtaEvent({ action: 'subtitles_search', label: `搜尋：${query || ''}`, location: 'search' })
    runSearch(query)
  }

  const download = (item: SubItem, keywordFromSearch: string) => {
    const rowId = `${item.id}-${item.lang_code || item.language || ''}`
    setDownloadHints((prev) => {
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
    const token = getToken()
    const url = api.subsDownloadUrl(item, item.lang_code || 'zht', keywordFromSearch)
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
        setToast(`已下載 ${name}，檔案已自動修正為標準 SRT 格式`)
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

  const openSourcePage = (item: SubItem) => {
    if (!item.page_url) return
    window.open(item.page_url, '_blank', 'noopener,noreferrer')
  }

  const langCounts = useMemo(() => ({
    all: results.length,
    zht: results.filter((item) => matchesLangFilter(item, 'zht')).length,
    zhs: results.filter((item) => matchesLangFilter(item, 'zhs')).length,
  }), [results])

  const resultsTotalPages = Math.max(1, Math.ceil(filteredResults.length / RESULTS_PAGE_SIZE))
  const resultsSlice = filteredResults.slice(
    (resultsPage - 1) * RESULTS_PAGE_SIZE,
    resultsPage * RESULTS_PAGE_SIZE
  )

  const langFilterOptions: { id: LangFilter; label: string }[] = [
    { id: 'all', label: `全部（${langCounts.all}）` },
    { id: 'zht', label: `繁中（${langCounts.zht}）` },
    { id: 'zhs', label: `簡中（${langCounts.zhs}）` },
  ]

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="subs-hero-heading">
        <h1 id="subs-hero-heading" className={styles.heroTitle}>繁中／簡中字幕，一站搜尋下載</h1>
        <p className={styles.heroSubtitle}>
          輸入番號或影片檔名即可搜尋，可貼上完整檔名，系統會自動擷取關鍵字。下載後自動驗證並修正 SRT 格式，確保播放器可正常載入。
        </p>
        <ul className={styles.featureList}>
          <li className={styles.featureItem}>
            <span className={styles.featureIcon}><FeatureIcon type="sources" /></span>
            <span className={styles.featureText}>整合 Subtitle Cat、AVSubtitles 等多個字幕來源</span>
          </li>
          <li className={styles.featureItem}>
            <span className={styles.featureIcon}><FeatureIcon type="format" /></span>
            <span className={styles.featureText}>下載後自動修正非標準 SRT，播放器可直接使用</span>
          </li>
          <li className={styles.featureItem}>
            <span className={styles.featureIcon}><FeatureIcon type="sort" /></span>
            <span className={styles.featureText}>繁中優先排序，推薦來源一目了然</span>
          </li>
        </ul>
      </section>

      <div className={styles.card}>
        <label className={styles.label} htmlFor="subs-query">搜尋關鍵字（影片檔名 / 片名）</label>
        <div className={styles.searchRow}>
          <input
            id="subs-query"
            type="search"
            className={styles.input}
            placeholder="例如：ABF-045 或 Movie.2024.1080p.mkv"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            autoComplete="off"
          />
          <button
            type="button"
            className={styles.btn}
            onClick={search}
            disabled={loading}
          >
            {loading ? '搜尋中…' : '搜尋'}
          </button>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {results.length > 0 && (
          <div className={styles.langFilterRow} role="group" aria-label="語言篩選">
            {langFilterOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={langFilter === opt.id ? styles.langFilterActive : styles.langFilterBtn}
                onClick={() => setLangFilter(opt.id)}
                disabled={opt.id !== 'all' && langCounts[opt.id] === 0}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className={styles.results}>
            <h3>
              符合的字幕（顯示 {filteredResults.length} / {results.length} 筆）
            </h3>
            {filteredResults.length === 0 ? (
              <p className={styles.filterEmpty}>此語言篩選下沒有結果，請切換其他語言。</p>
            ) : (
            <ul className={styles.list}>
              {resultsSlice.map((item) => {
                const rowId = `${item.id}-${item.lang_code || item.language || ''}`
                return (
                <li key={rowId} className={styles.resultItem}>
                  <div className={styles.resultMain}>
                    <span className={styles.itemName}>{item.release || item.file_name || item.id}</span>
                    {downloadHints[rowId] && (
                      <span
                        className={styles.alertIcon}
                        role="img"
                        aria-label="下載提示"
                        title={downloadHints[rowId]}
                        tabIndex={0}
                      >
                        <AlertIcon />
                      </span>
                    )}
                  </div>
                  <div className={styles.resultMeta}>
                    {isRecommendedItem(item) && (
                      <span className={styles.recommendedBadge} title="繁中 Subtitle Cat 來源，建議優先嘗試">
                        推薦
                      </span>
                    )}
                    {item.language && <span className={styles.lang}>{item.language}</span>}
                    {getSourceLabel(item.source) && (
                      <span className={styles.sourceBadge} title={getSourceLabel(item.source) || ''}>
                        {getSourceLabel(item.source)}
                      </span>
                    )}
                    {item.source === 'subtitlenexus' && (
                      <span className={styles.externalBadge} title="需前往來源網站下載">
                        外部下載
                      </span>
                    )}
                  </div>
                  <div className={styles.resultActions}>
                    {item.source === 'subtitlenexus' ? (
                      <button
                        type="button"
                        className={styles.dlBtn}
                        onClick={() => {
                          trackCtaEvent({
                            action: 'subtitles_open_source',
                            label: `前往來源：${activeSearchKeyword || '未知關鍵字'}`,
                            location: 'results',
                          })
                          openSourcePage(item)
                        }}
                      >
                        前往來源
                      </button>
                    ) : (
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
                    )}
                  </div>
                </li>
              )})}
            </ul>
            )}
            {filteredResults.length > RESULTS_PAGE_SIZE && (
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
                  {resultsPage} / {resultsTotalPages}（共 {filteredResults.length} 筆）
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

      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}

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
