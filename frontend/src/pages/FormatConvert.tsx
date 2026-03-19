import styles from './FormatConvert.module.css'

const samples = [
  {
    title: '查詢 ffmpeg 是否安裝',
    cmd: 'ffmpeg -version',
    desc: '先確認本機已安裝 ffmpeg。',
  },
  {
    title: 'MP4 轉 MKV（不重編碼，最快）',
    cmd: 'ffmpeg -i "input.mp4" -c copy "output.mkv"',
    desc: '僅變更容器格式，幾乎不耗時、不降畫質。',
  },
  {
    title: 'MKV 轉 MP4（不重編碼，最快）',
    cmd: 'ffmpeg -i "input.mkv" -c copy "output.mp4"',
    desc: '若播放器偏好 MP4，可直接封裝轉換。',
  },
  {
    title: '轉為 H.264 + AAC（相容性高）',
    cmd: 'ffmpeg -i "input.mkv" -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 192k "output.mp4"',
    desc: '舊裝置或社群平台常用格式，速度較慢但相容性佳。',
  },
  {
    title: '只抽出音訊（MP3）',
    cmd: 'ffmpeg -i "input.mkv" -vn -c:a libmp3lame -q:a 2 "output.mp3"',
    desc: '想把影片轉成純音樂/語音檔可用。',
  },
  {
    title: '嵌入字幕（硬字幕）',
    cmd: 'ffmpeg -i "input.mp4" -vf "subtitles=sub.srt" -c:v libx264 -crf 23 -c:a copy "output_subbed.mp4"',
    desc: '字幕會直接燒錄在畫面上。',
  },
]

export default function FormatConvert() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>格式轉換（本地端 ffmpeg）</h1>
      <p className={styles.hint}>
        建議在本機用 ffmpeg 做轉檔：速度快、可批次處理、格式支援最完整。
      </p>

      <div className={styles.card}>
        <h2>快速上手</h2>
        <ol>
          <li>先安裝 ffmpeg（macOS: <code>brew install ffmpeg</code>）。</li>
          <li>打開終端機，切到檔案資料夾（<code>cd</code> 到目標路徑）。</li>
          <li>複製下方指令，將檔名改成你的檔案後執行。</li>
        </ol>
      </div>

      <div className={styles.list}>
        {samples.map((s) => (
          <article className={styles.item} key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
            <pre className={styles.code}>
              <code>{s.cmd}</code>
            </pre>
          </article>
        ))}
      </div>

      <p className={styles.hint}>
        小提醒：路徑或檔名有空白時，請用雙引號包起來（例如 <code>"My Video.mp4"</code>）。
      </p>
    </div>
  )
}

