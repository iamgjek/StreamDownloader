import { useState, useEffect, useMemo } from 'react'
import { api } from '../api/client'
import styles from './Dashboard.module.css'

type UserRow = { id: number; email: string; username: string; is_admin: boolean; created_at: string }
type DownloadRow = {
  id: number; user_id: number; username: string; url: string; title: string | null;
  og_title: string | null; og_description: string | null;
  status: string; progress: number; message: string | null; created_at: string; completed_at: string | null;
}

function toDateKey(iso: string) {
  return new Date(iso).toISOString().slice(0, 10)
}

export default function Dashboard() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [downloads, setDownloads] = useState<DownloadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    Promise.all([api.adminUsers(), api.adminDownloads()])
      .then(([u, d]) => {
        setUsers(u)
        setDownloads(d)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '載入失敗'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const kpis = useMemo(() => {
    const today = toDateKey(new Date().toISOString())
    const completed = downloads.filter((d) => d.status === 'completed').length
    const failed = downloads.filter((d) => d.status === 'failed' || d.status === 'error').length
    const pending = downloads.filter((d) => d.status !== 'completed' && d.status !== 'failed' && d.status !== 'error').length
    const total = downloads.length
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0
    const todayDownloads = downloads.filter((d) => toDateKey(d.created_at) === today).length
    const adminCount = users.filter((u) => u.is_admin).length
    const last7Days = (() => {
      const days: { date: string; count: number }[] = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        days.push({
          date: key,
          count: downloads.filter((x) => toDateKey(x.created_at) === key).length,
        })
      }
      return days
    })()
    return {
      totalUsers: users.length,
      adminCount,
      totalDownloads: total,
      todayDownloads,
      completed,
      failed,
      pending,
      successRate,
      last7Days,
    }
  }, [users, downloads])

  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [editUserForm, setEditUserForm] = useState({ username: '', email: '', password: '', is_admin: false })
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [addUserForm, setAddUserForm] = useState({ email: '', username: '', password: '' })
  const [filterUser, setFilterUser] = useState<string>('')
  const [filterUrlKeyword, setFilterUrlKeyword] = useState('')

  const filteredDownloads = useMemo(() => {
    return downloads.filter((d) => {
      if (filterUser && d.username !== filterUser) return false
      if (filterUrlKeyword.trim() && !d.url.toLowerCase().includes(filterUrlKeyword.trim().toLowerCase())) return false
      return true
    })
  }, [downloads, filterUser, filterUrlKeyword])

  const downloadUsernames = useMemo(() => {
    const set = new Set(downloads.map((d) => d.username))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [downloads])

  const openEditUser = (u: UserRow) => {
    setEditUser(u)
    setEditUserForm({ username: u.username, email: u.email, password: '', is_admin: u.is_admin })
  }
  const saveUser = async () => {
    if (!editUser) return
    try {
      await api.adminUserUpdate(editUser.id, {
        username: editUserForm.username,
        email: editUserForm.email,
        ...(editUserForm.password ? { password: editUserForm.password } : {}),
        is_admin: editUserForm.is_admin,
      })
      setEditUser(null)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '儲存失敗')
    }
  }

  const addUser = async () => {
    try {
      await api.adminUserCreate(addUserForm)
      setAddUserOpen(false)
      setAddUserForm({ email: '', username: '', password: '' })
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '新增失敗')
    }
  }

  const deleteUser = async (id: number) => {
    if (!confirm('確定要刪除此會員？')) return
    try {
      await api.adminUserDelete(id)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗')
    }
  }

  const deleteDownload = async (id: number) => {
    if (!confirm('確定要刪除此筆下載紀錄？')) return
    try {
      await api.adminDownloadDelete(id)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '刪除失敗')
    }
  }

  if (loading) return <div className={styles.page}><p className={styles.loading}>載入中…</p></div>
  if (error) return <div className={styles.page}><p className={styles.error}>{error}</p></div>

  return (
    <div className={styles.page}>
      <header className={styles.dashHeader}>
        <div>
          <h1 className={styles.title}>管理後台</h1>
          <p className={styles.hint}>營運總覽與會員、下載紀錄（僅管理員可見）</p>
        </div>
        <span className={styles.lastUpdated}>即時</span>
      </header>

      <section className={styles.kpiSection} aria-label="關鍵指標">
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>總會員數</span>
            <span className={styles.kpiValue}>{kpis.totalUsers}</span>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>管理員</span>
            <span className={styles.kpiValue}>{kpis.adminCount}</span>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>總下載數</span>
            <span className={styles.kpiValue}>{kpis.totalDownloads}</span>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>今日下載</span>
            <span className={styles.kpiValue}>{kpis.todayDownloads}</span>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>成功率</span>
            <span className={`${styles.kpiValue} ${kpis.successRate >= 80 ? styles.kpiPositive : kpis.successRate >= 50 ? styles.kpiNeutral : styles.kpiNegative}`}>
              {kpis.successRate}%
            </span>
          </div>
        </div>
      </section>

      <section className={styles.trendSection} aria-label="近七日下載趨勢">
        <h2 className={styles.trendTitle}>近 7 日下載量</h2>
        <div className={styles.trendChart}>
          {kpis.last7Days.map(({ date, count }) => (
            <div key={date} className={styles.trendBarWrap}>
              <div
                className={styles.trendBar}
                style={{ height: `${Math.max(4, (count / Math.max(1, ...kpis.last7Days.map((d) => d.count))) * 100)}%` }}
                title={`${date}: ${count} 筆`}
              />
              <span className={styles.trendLabel}>{new Date(date + 'T12:00:00').toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}</span>
              <span className={styles.trendCount}>{count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="users-heading">
        <div className={styles.sectionHead}>
          <h2 id="users-heading">會員列表</h2>
          <button type="button" className={styles.btnPrimary} onClick={() => setAddUserOpen(true)}>新增會員</button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>使用者名稱</th>
                <th>信箱</th>
                <th>管理員</th>
                <th>註冊時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>{u.is_admin ? '是' : '—'}</td>
                  <td>{new Date(u.created_at).toLocaleString('zh-TW')}</td>
                  <td>
                    <button type="button" className={styles.btnSm} onClick={() => openEditUser(u)}>編輯</button>
                    {u.username === 'admin' ? (
                      <button type="button" className={styles.btnSmDanger} disabled title="admin 不可以刪除">刪除</button>
                    ) : (
                      <button type="button" className={styles.btnSmDanger} onClick={() => deleteUser(u.id)}>刪除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="downloads-heading">
        <div className={styles.sectionHead}>
          <h2 id="downloads-heading">下載紀錄</h2>
          <div className={styles.statusSummary}>
            <span className={styles.statusSummaryItem}><span className={styles.dotSuccess} /> 完成 {kpis.completed}</span>
            <span className={styles.statusSummaryItem}><span className={styles.dotError} /> 失敗 {kpis.failed}</span>
            <span className={styles.statusSummaryItem}><span className={styles.dotNeutral} /> 進行中 {kpis.pending}</span>
          </div>
        </div>
        <p className={styles.hintSmall}>標題從該筆 URL 的 og:title 取得、描述從 og:description 取得；可編輯或按「從網址取得」重新抓取。</p>

        <div className={styles.filterRow}>
          <label className={styles.filterLabel}>
            <span className={styles.filterLabelText}>使用者</span>
            <select
              className={styles.filterSelect}
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              aria-label="依使用者篩選"
            >
              <option value="">全部</option>
              {downloadUsernames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel}>
            <span className={styles.filterLabelText}>網址關鍵字</span>
            <input
              type="text"
              className={styles.filterInput}
              placeholder="輸入網址關鍵字"
              value={filterUrlKeyword}
              onChange={(e) => setFilterUrlKeyword(e.target.value)}
              aria-label="依網址關鍵字篩選"
            />
          </label>
          {(filterUser || filterUrlKeyword.trim()) && (
            <button
              type="button"
              className={styles.filterClear}
              onClick={() => { setFilterUser(''); setFilterUrlKeyword('') }}
            >
              清除篩選
            </button>
          )}
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>使用者</th>
                <th>網址</th>
                <th>標題</th>
                <th>描述</th>
                <th>狀態</th>
                <th>時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredDownloads.map((d) => (
                <tr key={d.id}>
                  <td>{d.id}</td>
                  <td>{d.username}</td>
                  <td className={styles.url}>{d.url}</td>
                  <td className={styles.cellClip}>{d.og_title ?? d.title ?? '—'}</td>
                  <td className={styles.desc}>{d.og_description || '—'}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${d.status === 'completed' ? styles.statusSuccess : d.status === 'failed' || d.status === 'error' ? styles.statusError : styles.statusNeutral}`}>
                      {d.status}
                    </span>
                  </td>
                  <td>{new Date(d.created_at).toLocaleString('zh-TW')}</td>
                  <td>
                    <button type="button" className={styles.btnSmDanger} onClick={() => deleteDownload(d.id)}>刪除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editUser && (
        <div className={styles.modalOverlay} onClick={() => setEditUser(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>編輯會員</h3>
            <label className={styles.label}>使用者名稱</label>
            <input className={styles.input} value={editUserForm.username} onChange={(e) => setEditUserForm((f) => ({ ...f, username: e.target.value }))} />
            <label className={styles.label}>信箱</label>
            <input type="email" className={styles.input} value={editUserForm.email} onChange={(e) => setEditUserForm((f) => ({ ...f, email: e.target.value }))} />
            <label className={styles.label}>新密碼（留空不變）</label>
            <input type="password" className={styles.input} value={editUserForm.password} onChange={(e) => setEditUserForm((f) => ({ ...f, password: e.target.value }))} placeholder="選填" />
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={editUserForm.is_admin} onChange={(e) => setEditUserForm((f) => ({ ...f, is_admin: e.target.checked }))} />
              管理員
            </label>
            <div className={styles.modalActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setEditUser(null)}>取消</button>
              <button type="button" className={styles.btnPrimary} onClick={saveUser}>儲存</button>
            </div>
          </div>
        </div>
      )}

      {addUserOpen && (
        <div className={styles.modalOverlay} onClick={() => setAddUserOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>新增會員</h3>
            <label className={styles.label}>信箱</label>
            <input type="email" className={styles.input} value={addUserForm.email} onChange={(e) => setAddUserForm((f) => ({ ...f, email: e.target.value }))} required />
            <label className={styles.label}>使用者名稱</label>
            <input className={styles.input} value={addUserForm.username} onChange={(e) => setAddUserForm((f) => ({ ...f, username: e.target.value }))} required />
            <label className={styles.label}>密碼</label>
            <input type="password" className={styles.input} value={addUserForm.password} onChange={(e) => setAddUserForm((f) => ({ ...f, password: e.target.value }))} required />
            <div className={styles.modalActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setAddUserOpen(false)}>取消</button>
              <button type="button" className={styles.btnPrimary} onClick={addUser}>新增</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
