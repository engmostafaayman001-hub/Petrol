import type { NextConfig } from 'next';

/**
 * Security headers are applied at the edge for every route. The CSP is
 * intentionally strict; the only external origin the app talks to is the
 * Supabase project URL, which is injected at build time.
 */
const supabaseOrigin = (() => {
  try {
    // Prefer NEXT_PUBLIC_* (client) value, fallback to server-only SUPABASE_URL
    const candidate = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'https://localhost';
    return new URL(candidate).origin;
  } catch {
    return '';
  }
})();

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  // Next.js injects inline bootstrap scripts; 'unsafe-inline' is required for
  // the App Router runtime and is scoped to 'self' origins only.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace('https://', 'wss://')}`.trim(),
]
  .filter(Boolean)
  .join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
