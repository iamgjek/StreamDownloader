import { useEffect } from 'react'

const SCRIPT_ID = 'json-ld-page'

export function useJsonLd(data: Record<string, unknown> | null) {
  useEffect(() => {
    if (!data) {
      document.getElementById(SCRIPT_ID)?.remove()
      return
    }

    let el = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!el) {
      el = document.createElement('script')
      el.id = SCRIPT_ID
      el.type = 'application/ld+json'
      document.head.appendChild(el)
    }
    el.textContent = JSON.stringify(data)

    return () => {
      document.getElementById(SCRIPT_ID)?.remove()
    }
  }, [data])
}
