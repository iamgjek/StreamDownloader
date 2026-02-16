import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { getToken } from '../api/client'
import styles from './Download.module.css'

type HistoryItem = { id: number; url: string; title: string | null; og_description: string | null; status: string; created_at: string }

export default function Download() {
  const [url, setUrl] = useState('')
  const [jobId, setJobId] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyLimit = 10

  const loadHistory = useCallback(async (page = 1) => {
    setHistoryLoading(true)
    try {
      const res = await api.downloadsHistory(page, historyLimit)
      setHistory(res.items)
      setHistoryTotal(res.total)
      setHistoryPage(res.page)
    } catch {
      setHistory([])
      setHistoryTotal(0)
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory(1) }, [loadHistory])

  const pollInterval = 1500

  const startDownload = async () => {
    setError('')
    if (!url.trim()) {
      setError('請輸入影片網址')
      return
    }
    try {
      const { job_id } = await api.downloadStart(url.trim(), 'video')
      setJobId(job_id)
      setStatus('pending')
      setProgress(0)
      setMessage('排隊中…')
      setTitle(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法開始下載')
    }
  }

  // Poll status when we have a job
  useEffect(() => {
    if (jobId == null) return
    const t = setInterval(async () => {
      try {
        const s = await api.downloadStatus(jobId)
        setStatus(s.status)
        setProgress(s.progress)
        setMessage(s.message || '')
        if (s.title) setTitle(s.title)
        if (s.status === 'done') {
          setJobId(null)
          loadHistory(1)
          // Trigger file download
          const token = getToken()
          const res = await fetch(`/api/download/result/${jobId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          if (!res.ok) throw new Error('無法取得檔案')
          const blob = await res.blob()
          const disp = res.headers.get('Content-Disposition')
          let filename = 'download.mkv'
          if (disp) {
            const m = disp.match(/filename\*?=(?:UTF-8'')?([^;]+)/)
            if (m) filename = m[1].trim().replace(/^["']|["']$/g, '')
          }
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = filename
          a.click()
          URL.revokeObjectURL(a.href)
        }
        if (s.status === 'error') {
          setError(s.message || '下載失敗')
          setJobId(null)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '狀態查詢失敗')
      }
    }, pollInterval)
    return () => clearInterval(t)
  }, [jobId, message])

  const isLoading = jobId != null && status !== 'done' && status !== 'error'

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>影片下載</h1>
      <p className={styles.hint}>
        貼上影片網址後開始下載，即時顯示進度；完成時會儲存為 .mkv 至瀏覽器下載位置（可於下載時選擇存放位置）。
      </p>

      <div className={styles.card}>
        <label className={styles.label} htmlFor="download-url">影片網址</label>
        <input
          id="download-url"
          type="url"
          className={styles.input}
          placeholder="https://www.youtube.com/watch?v=... 或 https://missav.ai/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isLoading}
          aria-describedby={error ? 'download-error' : undefined}
        />

        <button
          type="button"
          className={styles.btn}
          onClick={startDownload}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? '下載中…' : '開始下載'}
        </button>

        {isLoading && (
          <div className={styles.progressUI}>
            <div className={styles.progressStatus}>
              {status === 'pending' && '排隊中'}
              {status === 'downloading' && '下載中'}
              {status === 'done' && '完成'}
            </div>
            <div className={styles.progressBarWrap}>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <span className={styles.progressPct}>{progress}%</span>
            </div>
            <p className={styles.progressMessage}>{message || '處理中…'}</p>
            {title && <p className={styles.progressTitle}>{title}</p>}
          </div>
        )}

        {error && <p id="download-error" className={styles.error} role="alert">{error}</p>}
      </div>

      <section className={styles.historySection} aria-labelledby="download-history-heading">
        <h2 id="download-history-heading" className={styles.historyTitle}>下載紀錄</h2>
        {historyLoading ? (
          <p className={styles.historyEmpty}>載入中…</p>
        ) : history.length === 0 ? (
          <p className={styles.historyEmpty}>尚無下載紀錄</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>網址</th>
                    <th>標題</th>
                    <th>描述</th>
                    <th>狀態</th>
                    <th>時間</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td className={styles.cellUrl}>{item.url}</td>
                      <td className={styles.cellTitle}>{item.title || '—'}</td>
                      <td className={styles.cellDesc}>{item.og_description || '—'}</td>
                      <td>{item.status}</td>
                      <td className={styles.cellTime}>{new Date(item.created_at).toLocaleString('zh-TW')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {historyTotal > historyLimit && (
              <div className={styles.historyPagination}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={historyPage <= 1 || historyLoading}
                  onClick={() => loadHistory(historyPage - 1)}
                >
                  上一頁
                </button>
                <span className={styles.pageInfo}>
                  {historyPage} / {Math.ceil(historyTotal / historyLimit)}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={historyPage >= Math.ceil(historyTotal / historyLimit) || historyLoading}
                  onClick={() => loadHistory(historyPage + 1)}
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
