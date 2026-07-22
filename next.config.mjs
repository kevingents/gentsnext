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
