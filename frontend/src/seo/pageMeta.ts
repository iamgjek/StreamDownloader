export const SITE_NAME = 'Stream Downloader'

export const DEFAULT_DESCRIPTION =
  'Stream Downloader：支援 MissAV、YouTube 等平台的影片下載，整合繁中／簡中字幕搜尋與 ffmpeg 格式轉換指令，一站完成影音處理。'

export type PageMetaConfig = {
  title: string
  description: string
  path: string
  noindex?: boolean
}

export const PAGE_META: Record<string, PageMetaConfig> = {
  download: {
    title: '影片下載',
    description:
      '貼上 MissAV、YouTube 等影片網址即可下載，支援進度追蹤與下載紀錄。登入後即可使用 Stream Downloader 線上影片下載服務。',
    path: '/',
  },
  subtitles: {
    title: '字幕下載',
    description:
      '依影片檔名或片名搜尋繁中、簡中字幕，整合 Subtitle Cat、AVSubtitles 等來源，下載後自動驗證 SRT 格式，確保播放器可正常載入。',
    path: '/subtitles',
  },
  convert: {
    title: '格式轉換',
    description:
      '常用 ffmpeg 影片格式轉換指令參考：MP4/MKV 互轉、H.264 重編碼、音訊抽取與字幕燒錄，快速複製指令在本機執行。',
    path: '/convert',
  },
  login: {
    title: '登入 / 註冊',
    description: '登入或註冊 Stream Downloader 帳號，使用影片下載、字幕搜尋與個人下載紀錄等功能。',
    path: '/login',
  },
  dashboard: {
    title: '管理後台',
    description: 'Stream Downloader 管理後台：檢視會員與下載紀錄。',
    path: '/dashboard',
    noindex: true,
  },
}
