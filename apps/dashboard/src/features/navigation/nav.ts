import {
  ChartColumn,
  FlaskConical,
  LayoutDashboard,
  LifeBuoy,
  Network,
  ScrollText,
  Server,
  Siren,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Page heading, used by the router and route tests. */
  heading: string;
  /** Plain-language label in the Easy view; items without one are Advanced-only (ADR-013). */
  easyLabel?: string;
}

/**
 * The §2.2 information architecture. Incident Detail (/incidents/:incidentId)
 * is the ninth page and is reached from the Incidents list.
 * Single source for the sidebar, the router and tests.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/overview',
    label: 'Overview',
    icon: LayoutDashboard,
    heading: 'Overview',
    easyLabel: 'Home',
  },
  { path: '/infrastructure', label: 'Infrastructure', icon: Server, heading: 'Infrastructure' },
  {
    path: '/incidents',
    label: 'Incidents',
    icon: Siren,
    heading: 'Incidents',
    easyLabel: 'Incidents',
  },
  { path: '/recovery', label: 'Recovery Center', icon: LifeBuoy, heading: 'Recovery Center' },
  {
    path: '/simulation-lab',
    label: 'Simulation Lab',
    icon: FlaskConical,
    heading: 'Simulation Lab',
    easyLabel: 'Practice lab',
  },
  { path: '/analytics', label: 'Analytics', icon: ChartColumn, heading: 'Analytics' },
  { path: '/architecture', label: 'Architecture', icon: Network, heading: 'Architecture' },
  {
    path: '/audit',
    label: 'Audit & Settings',
    icon: ScrollText,
    heading: 'Audit & Settings',
    easyLabel: 'Activity & settings',
  },
];

export const incidentPath = (incidentId: string): string =>
  `/incidents/${encodeURIComponent(incidentId)}`;

/** Nav items for a view: Easy shows only items with an easy label, under that label. */
export function navFor(view: 'easy' | 'advanced'): { item: NavItem; label: string }[] {
  return NAV_ITEMS.filter((i) => view === 'advanced' || i.easyLabel).map((item) => ({
    item,
    label: view === 'easy' && item.easyLabel ? item.easyLabel : item.label,
  }));
}
