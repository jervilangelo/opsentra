import type { RouteObject } from 'react-router';

import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { ArchitecturePage } from '@/features/architecture/ArchitecturePage';
import { AuditSettingsPage } from '@/features/audit/AuditSettingsPage';
import { SignInPage } from '@/features/auth/SignInPage';
import { NotFoundPage, RouteErrorPage } from '@/features/errors/ErrorPages';
import { IncidentDetailPage } from '@/features/incidents/IncidentDetailPage';
import { IncidentsPage } from '@/features/incidents/IncidentsPage';
import { InfrastructurePage } from '@/features/infrastructure/InfrastructurePage';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { RecoveryCenterPage } from '@/features/recovery/RecoveryCenterPage';
import { SimulationLabPage } from '@/features/simulation-lab/SimulationLabPage';

import { AppShell } from './AppShell';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'infrastructure', element: <InfrastructurePage /> },
      { path: 'incidents', element: <IncidentsPage /> },
      { path: 'incidents/:incidentId', element: <IncidentDetailPage /> },
      { path: 'recovery', element: <RecoveryCenterPage /> },
      { path: 'simulation-lab', element: <SimulationLabPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'architecture', element: <ArchitecturePage /> },
      { path: 'audit', element: <AuditSettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '/sign-in', element: <SignInPage />, errorElement: <RouteErrorPage /> },
];
