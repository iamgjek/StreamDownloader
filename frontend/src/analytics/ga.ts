export type TrackCtaOptions = {
  action: string
  label?: string
  location?: string
}

export function trackCtaEvent({ action, label, location }: TrackCtaOptions) {
  try {
    const w = window as unknown as {
      gtag?: (eventName: string, eventParams?: Record<string, unknown>) => void
      dataLayer?: Array<Record<string, unknown>>
    }

    const payload: Record<string, unknown> = {
      event_category: 'CTA',
      event_action: action,
      event_label: label ?? action,
      page_path: window.location?.pathname,
    }
    if (location) payload.cta_location = location

    if (typeof w.gtag === 'function') {
      // GA4 gtag event: gtag('event', 'cta_click', { ...params })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(w.gtag as any)('event', 'cta_click', payload)
      return
    }

    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: 'cta_click', ...payload })
    }
  } catch {
    // ignore
  }
}

