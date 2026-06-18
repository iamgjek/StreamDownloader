import { useEffect } from 'react'
import { DEFAULT_DESCRIPTION, SITE_NAME, type PageMetaConfig } from '../seo/pageMeta'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`
  let el = document.head.querySelector(selector) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  const selector = `link[rel="${rel}"]`
  let el = document.head.querySelector(selector) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export function usePageMeta(config: PageMetaConfig) {
  const { title, description, path, noindex } = config

  useEffect(() => {
    const fullTitle = `${title} | ${SITE_NAME}`
    const origin = window.location.origin
    const canonical = `${origin}${path}`

    document.title = fullTitle
    document.documentElement.lang = 'zh-Hant'

    upsertMeta('name', 'description', description)
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow')
    upsertMeta('property', 'og:site_name', SITE_NAME)
    upsertMeta('property', 'og:title', fullTitle)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:url', canonical)
    upsertMeta('property', 'og:locale', 'zh_TW')
    upsertMeta('name', 'twitter:card', 'summary')
    upsertMeta('name', 'twitter:title', fullTitle)
    upsertMeta('name', 'twitter:description', description)
    upsertLink('canonical', canonical)

    return () => {
      document.title = SITE_NAME
      upsertMeta('name', 'description', DEFAULT_DESCRIPTION)
      upsertMeta('name', 'robots', 'index, follow')
      upsertMeta('property', 'og:title', SITE_NAME)
      upsertMeta('property', 'og:description', DEFAULT_DESCRIPTION)
      upsertLink('canonical', origin)
    }
  }, [title, description, path, noindex])
}
