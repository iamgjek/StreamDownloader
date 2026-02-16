import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { getToken } from '../api/client'
import styles from './Download.module.css'

type HistoryItem = { id: number; url: string; title: string | null; og_description: string | null; status: string; created_at: string }

/** 是否支援「先選資料夾再存檔」（File System Access API，Chrome/Edge 等） */
const supportsPickDir = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export default function Download() {
  const [url, setUrl] = useState('')
  const [jobId, setJobId] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState<string | null>(null)
  /** 使用者先選好的下載資料夾（僅限支援 showDirectoryPicker 的瀏覽器） */
  const [downloadDirHandle, setDownloadDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [downloadDirName, setDownloadDirName] = useState<string>('')

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

  const cancelDownload = async () => {
    if (jobId == null) return
    try {
      await api.downloadCancel(jobId)
      setStatus('cancelled')
      setMessage('已取消')
      setJobId(null)
      loadHistory(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消失敗')
    }
  }

  /** 先選擇下載位置（需支援 File System Access API） */
  const pickDownloadDir = async () => {
    if (!supportsPickDir) return
    setError('')
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      setDownloadDirHandle(handle)
      setDownloadDirName(handle.name)
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message || '無法取得資料夾權限')
      }
    }
  }

  /** 將 blob 存到指定檔名：有選資料夾則寫入該資料夾，否則用瀏覽器下載 */
  const saveBlobToTarget = async (blob: Blob, filename: string) => {
    const safeName = filename.replace(/[/\\?*:|"]/g, '_').trim() || 'download.mkv'
    if (downloadDirHandle) {
      try {
        const fileHandle = await downloadDirHandle.getFileHandle(safeName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
      } catch (e) {
        setError(e instanceof Error ? e.message : '寫入資料夾失敗')
      }
      return
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = safeName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    }, 500)
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
        if (s.status === 'cancelled') {
          setJobId(null)
          loadHistory(1)
          return
        }
        if (s.status === 'done') {
          setJobId(null)
          loadHistory(1)
          // 使用 API 基礎 URL 取檔（部署時 /api 須指到後端）
          const downloadUrl = api.downloadResultUrl(jobId)
          try {
            const res = await fetch(downloadUrl)
            if (!res.ok) throw new Error('無法取得檔案')
            const blob = await res.blob()
            const disp = res.headers.get('Content-Disposition')
            let filename = 'download.mkv'
            if (disp) {
              const m = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i) ?? disp.match(/filename=([^;]+)/)
              if (m) filename = m[1].trim().replace(/^["']|["']$/g, '')
            }
            await saveBlobToTarget(blob, filename)
          } catch (e) {
            setError(e instanceof Error ? e.message : '檔案下載失敗')
          }
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
  }, [jobId, message, downloadDirHandle])

  const isLoading = jobId != null && status !== 'done' && status !== 'error' && status !== 'cancelled'
  const canCancel = jobId != null && (status === 'pending' || status === 'downloading')

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>影片下載</h1>
      <p className={styles.hint}>
        建議先選擇下載位置（大檔案直接存到指定資料夾），再貼上網址開始下載；完成後會儲存為 .mkv。
      </p>

      <div className={styles.card}>
        {supportsPickDir && (
          <div className={styles.downloadDirRow}>
            <label className={styles.label}>下載位置</label>
            <div className={styles.downloadDirControls}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={pickDownloadDir}
                disabled={isLoading}
                aria-label="選擇要存放檔案的資料夾"
              >
                {downloadDirName ? `已選擇：${downloadDirName}` : '選擇下載位置…'}
              </button>
              {downloadDirName && (
                <button
                  type="button"
                  className={styles.btnLink}
                  onClick={() => { setDownloadDirHandle(null); setDownloadDirName('') }}
                  aria-label="清除已選資料夾，改為瀏覽器預設下載"
                >
                  改為瀏覽器預設
                </button>
              )}
            </div>
          </div>
        )}
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

        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.btn}
            onClick={startDownload}
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? '下載中…' : '開始下載'}
          </button>
          {canCancel && (
            <button
              type="button"
              className={styles.btnCancel}
              onClick={cancelDownload}
              aria-label="中斷下載"
            >
              中斷下載
            </button>
          )}
        </div>

        {isLoading && (
          <div className={styles.progressUI}>
            <div className={styles.progressStatus}>
              {status === 'pending' && '排隊中'}
              {status === 'downloading' && '下載中'}
              {status === 'done' && '完成'}
              {status === 'cancelled' && '已取消'}
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
                      <td>{item.status === 'done' ? '完成' : item.status === 'error' ? '失敗' : item.status === 'cancelled' ? '已取消' : item.status === 'downloading' ? '下載中' : item.status}</td>
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
