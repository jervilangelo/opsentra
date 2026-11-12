import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';

import { Timestamp } from '@/components/data/Timestamp';
import { ModeBadge } from '@/components/mode/ModeBadge';
import { ModeSwitch } from '@/components/mode/ModeSwitch';
import { ViewSwitch } from '@/components/mode/ViewSwitch';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { DemoControlBar } from '@/features/demo/DemoControlBar';
import { useDemoRuntime } from '@/modes/demo/useDemoRuntime';
import { useMode } from '@/modes/mode-store';
import { usePreferences } from '@/stores/preferences';

import { SidebarBrand, SidebarNav } from './Sidebar';

/** Environment badge and last sync. Shows nothing it can't back with data. */
function SyncStatus() {
  const mode = useMode();
  return (
    <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
      <span className="rounded border px-1.5 py-0.5 whitespace-nowrap">
        {mode === 'demo' ? 'HarborPoint sandbox (fictional)' : 'Not connected'}
      </span>
      {mode === 'live' ? (
        <span className="flex items-center gap-1 whitespace-nowrap">
          Last sync: <Timestamp value={undefined} fallback="—" />
        </span>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const mode = useMode();
  const collapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggleSidebar = usePreferences((s) => s.toggleSidebar);
  const [mobileOpen, setMobileOpen] = useState(false);
  useDemoRuntime(mode === 'demo');

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] lg:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarBrand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <div className={cn('mt-auto p-2', collapsed && 'flex justify-center')}>
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn(!collapsed && 'w-full justify-start text-muted-foreground')}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            {collapsed ? null : <span>Collapse</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent aria-describedby="mobile-nav-desc">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription id="mobile-nav-desc" className="sr-only">
            Opsentra main navigation
          </SheetDescription>
          <SidebarBrand />
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
          <div className="mt-auto border-t p-4">
            <ViewSwitch />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Persistent mode banner: always visible, on every page. */}
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <div role="status" aria-label="Data mode" className="min-w-0">
              <ModeBadge mode={mode} />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <SyncStatus />
              <ViewSwitch className="hidden md:flex" />
              <ModeSwitch />
            </div>
          </div>
        </header>
        {/* Not sticky, so it never eats the viewport on small screens. */}
        {mode === 'demo' ? <DemoControlBar /> : null}

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>

        <footer className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
          Opsentra · Demo Mode is a simulation. HarborPoint Solutions is fictional; Demo Mode data
          is synthetic.
        </footer>
      </div>
    </div>
  );
}
