/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// On Windows, a lowercase drive letter in the working directory (c:\ vs C:\, as
// VS Code terminals use) makes Vite/Vitest load some modules twice (a second
// Vitest runner, or a second copy of React). Normalise the drive letter once
// and use the same spelling for the root and every alias.
const normalise = (p: string) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());
const root = normalise(fileURLToPath(new URL('.', import.meta.url)));
const src = normalise(fileURLToPath(new URL('./src', import.meta.url)));

// `base` stays "/" for local dev. A GitHub Pages sub-path (e.g. "/opsentra/")
// is set at publish time in Phase 10 via `--base`.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
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
  },
});
