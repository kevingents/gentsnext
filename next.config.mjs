/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // De Apple-Wallet-route leest de merk-PNG's van schijf; bundel die expliciet mee
  // in de serverless functie (public/ wordt anders niet in de lambda opgenomen).
  outputFileTracingIncludes: {
    '/api/wallet/apple': ['./public/brand/brand-logo-vierkant.png', './public/brand/brand-logo-zwart.png'],
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
};

export default nextConfig;
