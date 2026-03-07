/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.shopgoodwill.com' },
      { protocol: 'https', hostname: '**.ctbids.com' },
      { protocol: 'http', hostname: '**.shopgoodwill.com' },
    ],
  },
}

module.exports = nextConfig
