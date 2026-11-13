/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// On Windows, a lowercase drive letter in the working directory (c:\ vs C:\, as
// VS Code terminals use) makes Vite/Vitest load some modules twice (a second
// Vitest runner, or a second copy of React). Normalise the drive letter once
// and use the same spelling for the root and every alias.
const normalise = (p: string) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());
const root = normalise(fileURLToPath(new URL('.', import.meta.url)));
const src = normalise(fileURLToPath(new URL('./src', import.meta.url)));

/**
 * Content Security Policy for production builds (Phase 9, finding F5).
 * GitHub Pages cannot send headers, so the policy is a <meta> tag. Scripts:
 * this origin plus the one inline theme script, pinned by its SHA-256 hash.
 * Connections: this origin, the Live API and the Cognito domain from the
 * build's VITE_* config, nothing else. Styles allow 'unsafe-inline' because
 * the toast library injects a <style> tag at runtime; scripts never do.
 * Not applied to `vite dev`, whose HMR client needs inline scripts.
 */
export function cspPolicy(html: string, connect: string[]): string {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...connect].join(' ')}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function contentSecurityPolicy(env: Record<string, string>): Plugin {
  const origin = (url?: string) => {
    try {
      return url ? new URL(url).origin : undefined;
    } catch {
      return undefined;
    }
  };
  const connect = [
    origin(env.VITE_API_BASE_URL),
    env.VITE_COGNITO_DOMAIN ? `https://${env.VITE_COGNITO_DOMAIN}` : undefined,
  ].filter((v): v is string => Boolean(v));
  return {
    name: 'opsentra-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${cspPolicy(html, connect)}" />`,
        ),
    },
  };
}

// `base` stays "/" for local dev. A GitHub Pages sub-path (e.g. "/opsentra/")
// is set at publish time in Phase 10 via `--base`.
export default defineConfig(({ mode }) => ({
  root,
  plugins: [react(), tailwindcss(), contentSecurityPolicy(loadEnv(mode, root, 'VITE_'))],
  resolve: {
    alias: { '@': src },
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    // Tests never use a developer's local Live config (.env.local).
    env: {
      VITE_APP_MODE_DEFAULT: 'demo',
      VITE_API_BASE_URL: '',
      VITE_COGNITO_USER_POOL_ID: '',
      VITE_COGNITO_CLIENT_ID: '',
      VITE_COGNITO_DOMAIN: '',
    },
  },
}));
