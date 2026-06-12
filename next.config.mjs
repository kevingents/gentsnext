/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Productfoto's staan tijdens de migratie nog op de Shopify-CDN;
      // na re-hosting komen hier de eigen Blob/Sanity-hosts bij.
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
