const BACKEND_BASE = process.env.BACKEND_BASE ?? 'http://13.212.87.50'

function stripHopByHopHeaders(headers) {
  // 避免把主機/連線相關 header 轉發造成錯誤
  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
  ])

  const result = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (!hopByHop.has(k.toLowerCase())) result[k] = v
  }
  return result
}

export default async function handler(req, res) {
  const targetUrl = `${BACKEND_BASE}/api/login`
  const headers = stripHopByHopHeaders(req.headers)
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
  })

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  }).catch(async (e) => {
    // 若 fetch 失敗，把原因回給前端便於除錯
    res.status(502).json({ detail: 'Upstream request failed', error: String(e) })
  })

  if (!upstream) return
  const responseText = await upstream.text()
  res.status(upstream.status)
  const ct = upstream.headers.get('content-type')
  if (ct) res.setHeader('content-type', ct)
  res.end(responseText)
}

