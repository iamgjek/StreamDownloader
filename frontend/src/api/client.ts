const API = import.meta.env.VITE_API_BASE ?? '/api'

export function getToken(): string | null {
  return localStorage.getItem('stream_dl_token')
}

export async function request<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token = getToken(), ...rest } = opts
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string>),
  }
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
  const res = await fetch(API + path, { ...rest, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || res.statusText || 'Request failed')
  return data as T
}

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string }>('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, username: string, password: string) =>
    request<{ access_token: string }>('/register', { method: 'POST', body: JSON.stringify({ email, username, password }) }),
  me: () => request<{ id: number; email: string; username: string; is_admin: boolean; created_at: string }>('/me'),
  downloadStart: (url: string, download_type: 'video' | 'subs' | 'both') =>
    request<{ job_id: number }>('/download', { method: 'POST', body: JSON.stringify({ url, download_type }) }),
  downloadStatus: (jobId: number) =>
    request<{ job_id: number; status: string; progress: number; message: string | null; title: string | null }>(`/download/status/${jobId}`),
  downloadCancel: (jobId: number) =>
    request<{ ok: boolean }>(`/download/cancel/${jobId}`, { method: 'POST' }),
  downloadResultUrl: (jobId: number) => {
    const t = getToken()
    return `${API}/download/result/${jobId}${t ? `?token=${encodeURIComponent(t)}` : ''}`
  },
  subsSearch: (q: string, lang?: string) =>
    request<{ data: Array<{
      source?: string
      id: string
      file_id?: number
      release?: string
      language?: string
      download_url?: string
      file_name?: string
      page_url?: string
    }> }>(
      `/subs/search?q=${encodeURIComponent(q)}&lang=${lang || 'zht'}`
    ),
  subsDownloadUrl: (item: {
    source?: string
    file_id?: number
    download_url?: string
    page_url?: string
  }, lang?: string) => {
    const params = new URLSearchParams()
    const source = item.source || 'opensubtitles'
    params.set('source', source)
    if (source === 'subtitlecat' && item.page_url) {
      params.set('page_url', item.page_url)
      params.set('lang', lang || 'zht')
    } else {
      if (item.file_id != null) params.set('file_id', String(item.file_id))
      if (item.download_url) params.set('download_url', item.download_url)
    }
    const t = getToken()
    return `${API}/subs/download?${params.toString()}${t ? `&token=${encodeURIComponent(t)}` : ''}`
  },
  downloadsHistory: (page = 1, limit = 10) =>
    request<{ items: Array<{ id: number; url: string; title: string | null; og_description: string | null; status: string; created_at: string }>; total: number; page: number; limit: number }>(
      `/downloads/history?page=${page}&limit=${limit}`
    ),
  adminUsers: () => request<Array<{ id: number; email: string; username: string; is_admin: boolean; created_at: string }>>('/admin/users'),
  adminUserUpdate: (userId: number, data: { username?: string; email?: string; password?: string; is_admin?: boolean }) =>
    request<{ id: number; email: string; username: string; is_admin: boolean; created_at: string }>(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminUserCreate: (data: { email: string; username: string; password: string }) =>
    request<{ id: number; email: string; username: string; is_admin: boolean; created_at: string }>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  adminUserDelete: (userId: number) =>
    request<{ ok: boolean }>(`/admin/users/${userId}`, { method: 'DELETE' }),
  adminDownloads: () =>
    request<Array<{
      id: number; user_id: number; username: string; url: string; title: string | null;
      og_title: string | null; og_description: string | null;
      status: string; progress: number; message: string | null; created_at: string; completed_at: string | null;
    }>>('/admin/downloads'),
  adminDownloadUpdate: (logId: number, data: { title?: string; og_title?: string; og_description?: string }) =>
    request<{ id: number; user_id: number; username: string; url: string; title: string | null; og_title: string | null; og_description: string | null; status: string; progress: number; message: string | null; created_at: string; completed_at: string | null }>(`/admin/downloads/${logId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminDownloadFetchOg: (logId: number) =>
    request<{ og_title: string | null; og_description: string }>(`/admin/downloads/${logId}/fetch-og`, { method: 'POST' }),
  adminDownloadDelete: (logId: number) =>
    request<{ ok: boolean }>(`/admin/downloads/${logId}`, { method: 'DELETE' }),
}
