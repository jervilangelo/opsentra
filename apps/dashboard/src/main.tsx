import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { Providers } from './app/Providers';
import { routes } from './app/routes';

const router = createBrowserRouter(routes, {
  // Strip the trailing slash Vite adds so a GitHub Pages sub-path works later.
  basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
