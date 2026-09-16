import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Next.js 16 a retiré l'intégration d'ESLint du build (`next lint` et la clé
  // `eslint` de la configuration n'existent plus). Le lint est donc exécuté
  // séparément, dans la CI, via `npm run lint`.
  typescript: {
    ignoreBuildErrors: false,
  },

  // En-têtes de sécurité appliqués à toutes les réponses.
  // L'interface d'administration est une cible privilégiée : elle expose des
  // données de tous les utilisateurs.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
