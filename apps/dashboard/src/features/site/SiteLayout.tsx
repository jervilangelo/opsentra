import { ArrowRight, Star } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';

import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from './site';
import { StarPrompt } from './StarPrompt';

const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium no-underline transition-colors',
    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
  );

/** Public site shell: landing and about. The dashboard lives under /overview. */
export function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-auto no-underline" aria-label="Opsentra home">
            <Logo height={26} />
          </Link>
          <nav aria-label="Site" className="flex items-center gap-1">
            <NavLink to="/" end className={link}>
              Home
            </NavLink>
            <NavLink to="/about" className={link}>
              About
            </NavLink>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground no-underline hover:text-foreground sm:inline-flex"
            >
              <Star className="size-4" aria-hidden="true" />
              Star
              <span className="sr-only">Opsentra on GitHub (opens in a new tab)</span>
            </a>
          </nav>
          <Button asChild size="sm" className="ml-2">
            <Link to="/overview" className="no-underline">
              Open the dashboard
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Built by{' '}
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="underline">
              {AUTHOR_NAME}
            </a>
            . HarborPoint Solutions in the demo is fictional.
          </p>
          <p className="flex gap-4">
            <Link to="/about" className="underline">
              About
            </Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="underline">
              GitHub
            </a>
          </p>
        </div>
      </footer>
      <StarPrompt />
    </div>
  );
}
