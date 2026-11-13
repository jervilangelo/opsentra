import type { RouteObject } from 'react-router';

import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { ArchitecturePage } from '@/features/architecture/ArchitecturePage';
import { AuditSettingsPage } from '@/features/audit/AuditSettingsPage';
import { AuthCallbackPage } from '@/features/auth/AuthCallbackPage';
import { SignInPage } from '@/features/auth/SignInPage';
import { NotFoundPage, RouteErrorPage } from '@/features/errors/ErrorPages';
import { IncidentDetailPage } from '@/features/incidents/IncidentDetailPage';
import { IncidentsPage } from '@/features/incidents/IncidentsPage';
import { InfrastructurePage } from '@/features/infrastructure/InfrastructurePage';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { RecoveryCenterPage } from '@/features/recovery/RecoveryCenterPage';
import { SimulationLabPage } from '@/features/simulation-lab/SimulationLabPage';
import { AboutPage } from '@/features/site/AboutPage';
import { LandingPage } from '@/features/site/LandingPage';
import { SiteLayout } from '@/features/site/SiteLayout';

import { AppShell } from './AppShell';

export const routes: RouteObject[] = [
  // Public site (ADR-022): landing page and about, outside the dashboard shell.
  {
    path: '/',
    element: <SiteLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'about', element: <AboutPage /> },
    ],
  },
  // The dashboard. Overview moved from / to /overview (ADR-022).
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: 'overview', element: <OverviewPage /> },
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
  { path: '/auth/callback', element: <AuthCallbackPage />, errorElement: <RouteErrorPage /> },
];
