import { DEFAULT_DESCRIPTION, SITE_NAME } from './pageMeta'

export function buildSubtitlesHomeJsonLd(origin: string) {
  const siteUrl = `${origin}/`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}#website`,
        name: SITE_NAME,
        url: siteUrl,
        description: DEFAULT_DESCRIPTION,
        inLanguage: 'zh-TW',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${siteUrl}?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'WebApplication',
        '@id': `${siteUrl}#app`,
        name: `${SITE_NAME} 字幕下載`,
        url: siteUrl,
        description: DEFAULT_DESCRIPTION,
        applicationCategory: 'UtilityApplication',
        operatingSystem: 'Web',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'TWD',
        },
      },
    ],
  }
}
