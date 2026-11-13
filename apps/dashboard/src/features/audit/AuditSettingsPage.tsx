import { Monitor, Moon, Sun } from 'lucide-react';

import { PlannedPanel } from '@/components/feedback/states';
import { AuditLog } from './AuditLog';
import { PageHeader } from '@/components/layout/PageHeader';
import { ModeBadge } from '@/components/mode/ModeBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useMode } from '@/modes/mode-store';
import { useCurrentRole, useLiveMe } from '@/modes/session';
import { ROLE_LABEL } from '@/types/display';
import { usePreferences, useView, type ThemePreference } from '@/stores/preferences';
import { EasyActivity } from '@/features/easy/EasyActivity';
import { ViewSwitch } from '@/components/mode/ViewSwitch';

const THEMES: { value: ThemePreference; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemePicker() {
  const theme = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Theme</legend>
      <div className="flex flex-wrap gap-2">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              theme === value ? 'border-primary bg-accent' : 'hover:bg-accent/60',
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AuditSettingsPage() {
  const mode = useMode();
  const role = useCurrentRole();
  const me = useLiveMe();
  const view = useView();
  return (
    <>
      <PageHeader
        title="Audit & Settings"
        description="Read-only audit events, your role and display preferences."
      />
      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="audit">{view === 'easy' ? <EasyActivity /> : <AuditLog />}</TabsContent>
        <TabsContent value="settings" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Display</CardTitle>
              <CardDescription>Stored in this browser only.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-5">
                <ThemePicker />
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">View</span>
                  <ViewSwitch showLabel={false} />
                  <span className="text-xs text-muted-foreground">
                    Easy shows less, in plain words, with one clear next step. Advanced shows every
                    detail.
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Identity and role</CardTitle>
              <CardDescription>
                Roles come from trusted Cognito group claims checked by the backend, never from this
                page.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                Mode: <ModeBadge mode={mode} />
              </p>
              <p>
                Signed in:{' '}
                <span className="text-muted-foreground">
                  {mode === 'demo'
                    ? 'No. Demo Mode needs no account.'
                    : me.data
                      ? `Yes, as ${me.data.data.username ?? 'your Cognito user'}`
                      : 'No'}
                </span>
              </p>
              <p>
                Role:{' '}
                <span className="text-muted-foreground">
                  {!role
                    ? 'None'
                    : mode === 'demo'
                      ? `${ROLE_LABEL[role]} (simulated, Demo only; change it in the demo bar)`
                      : `${ROLE_LABEL[role]} (from your Cognito group, enforced by the backend)`}
                </span>
              </p>
            </CardContent>
          </Card>
          <PlannedPanel phase="future" title="Thresholds and toggles in the UI">
            Alarm thresholds, probe cadence and guardrails are set in Terraform and changed only
            through reviewed configuration. Editing them here is not built.
          </PlannedPanel>
        </TabsContent>
      </Tabs>
    </>
  );
}
