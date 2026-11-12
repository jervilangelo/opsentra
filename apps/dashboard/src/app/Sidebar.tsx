import { NavLink } from 'react-router';

import { BrandSymbol } from '@/components/brand/BrandSymbol';
import { Logo } from '@/components/brand/Logo';
import { navFor } from '@/features/navigation/nav';
import { cn } from '@/lib/utils';
import { useView } from '@/stores/preferences';

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const view = useView();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {navFor(view).map(({ item: { path, icon: Icon }, label }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              'flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium no-underline transition-colors',
              collapsed && 'justify-center px-0',
              isActive
                ? 'bg-accent text-foreground [&_svg]:text-primary'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className={cn(collapsed && 'sr-only')}>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Sidebar header: dark logo 28 px; collapsed shows the small-cut symbol at 24 px. */
export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn('flex h-14 items-center px-4', collapsed && 'justify-center px-0')}>
      {collapsed ? <BrandSymbol size={24} title="Opsentra" /> : <Logo height={28} />}
    </div>
  );
}
