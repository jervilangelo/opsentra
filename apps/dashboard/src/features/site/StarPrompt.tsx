import { Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { REPO_URL } from './site';

const KEY = 'opsentra:star-prompt';
const DELAY_MS = 4000;

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'dismissed';
  } catch {
    return false; // private mode or blocked storage: just show it
  }
}

/**
 * A gentle, non-modal invitation to star the repository on GitHub. It appears
 * after a few seconds, never blocks the page, and "Not now" is remembered in
 * this browser. It links to GitHub; it calls no API (CSP and privacy).
 */
export function StarPrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (dismissed()) return;
    const timer = window.setTimeout(() => setOpen(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, 'dismissed');
    } catch {
      /* not remembered; harmless */
    }
  };

  if (!open) return null;
  return (
    <aside
      aria-label="Star Opsentra on GitHub"
      className="fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-sm animate-slide-in rounded-lg border bg-card p-4 shadow-lg sm:left-auto"
    >
      <div className="flex items-start gap-3">
        <Star className="mt-0.5 size-5 shrink-0 fill-primary text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Enjoying Opsentra?</p>
          <p className="text-sm text-muted-foreground">
            If this project helped or interested you, a star on GitHub would mean a lot.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" className="group">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
                <Star className="group-hover:animate-twinkle" aria-hidden="true" />
                Star on GitHub
                <span className="sr-only">(opens GitHub in a new tab)</span>
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="ml-auto rounded-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
