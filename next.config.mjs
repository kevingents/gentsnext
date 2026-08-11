/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // De Apple-Wallet-route leest de merk-PNG's van schijf; bundel die expliciet mee
  // in de serverless functie (public/ wordt anders niet in de lambda opgenomen).
  outputFileTracingIncludes: {
    // Zwarte pas → witte merk-assets meebundelen (public/ zit anders niet in de lambda).
    '/api/wallet/apple': ['./public/brand/wallet-icon-wit.png', './public/brand/brand-logo-wit.png'],
    // De PassKit-webservice bouwt de pas óók (verse ophaal na een push).
    '/api/wallet/apple/v1/passes/[passTypeIdentifier]/[serialNumber]': ['./public/brand/wallet-icon-wit.png', './public/brand/brand-logo-wit.png'],
  },
  images: {
    // Modern AVIF eerst (kleiner, betere kwaliteit), WebP als fallback.
    formats: ['image/avif', 'image/webp'],
    // Realistische device-breedtes; bespaart cache-permutaties.
    deviceSizes: [360, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 dagen op de edge-cache
    remotePatterns: [
      // Productfoto's staan tijdens de migratie nog op de Shopify-CDN;
      // eigen beelden draaien op Vercel Blob.
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
    ],
  },
  eslint: {
    // Correctheid wordt bewaakt door `tsc --noEmit`; eslint-flat-config volgt later.
    ignoreDuringBuilds: true,
  },
  /**
   * De Site-studio op /account/* is opgeheven; al dat beheer zit nu in de
   * portal onder /site. Iedereen heeft die pagina's jarenlang als bladwijzer
   * gehad, dus ze landen op hun tegenhanger in plaats van op een 404.
   *
   * Bewust `permanent: false` (307): een 308 wordt hard door de browser gecachet
   * en dan kom je er nooit meer vanaf als een pad ooit anders moet. Zelfde keuze
   * als de portal maakte bij /nieuwe-site → /site.
   *
   * "team" gaat naar /site zonder eigen tegenhanger: het rollenmodel van de
   * webshop is vervallen — wie wat mag bepaalt de portal nu zelf.
   */
  async redirects() {
    const portal = (process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.gents.nl').replace(/\/+$/, '');
    const naar = {
      statistieken: '/site/omzet',
      analytics: '/site/gedrag',
      rapportages: '/site/rapportages',
      paginas: '/site/paginas',
      looks: '/site/looks',
      blog: '/site/blog',
      gelegenheden: '/site/gelegenheden',
      menu: '/site/menu',
      seo: '/site/seo',
      vertalingen: '/site/vertalingen',
      redirects: '/site/redirects',
      merchandising: '/site/merchandising',
      productmedia: '/site/productmedia',
      beeldstatus: '/site/foto/fotostatus',
      reviews: '/site/reviews',
      instellingen: '/site/instellingen',
      cadeaubonnen: '/site/cadeaubonnen',
      orders: '/site/bestellingen',
      klanten: '/site/klanten',
      fulfilment: '/site/fulfilment',
      team: '/site',
    };
    return Object.entries(naar).flatMap(([van, pad]) => [
      { source: `/account/${van}`, destination: `${portal}${pad}`, permanent: false },
      // Subpaden mee (/account/klanten/<id> → /site/klanten).
      { source: `/account/${van}/:rest*`, destination: `${portal}${pad}`, permanent: false },
    ]);
  },

  // Veilige, breed-toepasbare beveiligingsheaders (uit de Lighthouse-best-practices):
  // HSTS (Vercel is altijd HTTPS), clickjacking-bescherming, MIME-sniffing uit, en een
  // strak referrer-/permissions-beleid. Bewust GEEN CSP/COOP hier — die vergen
  // nonce-/OAuth-afstemming en kunnen legitieme flows breken; apart oppakken.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
