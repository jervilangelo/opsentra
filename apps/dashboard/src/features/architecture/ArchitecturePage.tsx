import { ArrowDown } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Static view of blueprint §3.1–3.2. Nothing here is deployed yet. */
const PLANES = [
  {
    name: 'Frontend Demo',
    scope: 'Static GitHub Pages build with synthetic data',
    posture: 'No AWS credentials or privileged calls',
    lifetime: 'Persistent',
  },
  {
    name: 'Control plane',
    scope: 'Cognito, API Gateway, Lambda, DynamoDB, EventBridge, SNS',
    posture: 'Authenticated, least privilege',
    lifetime: 'Long-lived when affordable',
  },
  {
    name: 'Lab plane',
    scope: 'Disposable EC2/Nginx, Lambda regression, test security group',
    posture: 'Tagged opsentra:lab=true, allowlisted, teardown mandatory',
    lifetime: 'Created only when testing',
  },
  {
    name: 'Terraform state',
    scope: 'Dedicated versioned, encrypted S3 bucket with native lockfile',
    posture: 'Never public',
    lifetime: 'Persistent',
  },
];

const DETECTION_FLOW = [
  'Health check Lambda probes the Nginx lab',
  'CloudWatch alarm enters ALARM',
  'EventBridge rule routes the alarm state change',
  'Incident ingest Lambda writes a deduplicated incident to DynamoDB',
  'Dashboard reads it through the authenticated API',
];

const RECOVERY_FLOW = [
  'Operator requests an allowlisted runbook',
  'Administrator approves (identity, reason and correlation ID audited)',
  'Action coordinator runs the fixed SSM document on the lab instance',
  'Independent health checks verify recovery',
  'Incident is marked RESOLVED only after verification',
];

function Flow({ title, steps }: { title: string; steps: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col items-stretch gap-1">
          {steps.map((s, idx) => (
            <li key={s} className="flex flex-col items-center gap-1">
              <span className="w-full rounded-md border bg-muted px-3 py-2 text-center text-sm">
                {s}
              </span>
              {idx < steps.length - 1 ? (
                <ArrowDown className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function ArchitecturePage() {
  return (
    <>
      <PageHeader
        title="Architecture"
        description="Planes, boundaries and event flow of Opsentra."
        actions={
          <Badge variant="outline" className="text-muted-foreground">
            Planned architecture · not yet deployed
          </Badge>
        }
      />
      <div className="flex flex-col gap-6">
        <section aria-labelledby="planes-heading" className="flex flex-col gap-3">
          <h2 id="planes-heading" className="text-lg">
            Planes and blast radius
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {PLANES.map((p) => (
              <Card key={p.name}>
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>{p.lifetime}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <p>{p.scope}</p>
                  <p className="text-muted-foreground">{p.posture}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <section aria-labelledby="flow-heading" className="flex flex-col gap-3">
          <h2 id="flow-heading" className="text-lg">
            Core incident flow (Scenario A)
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Flow title="Detect" steps={DETECTION_FLOW} />
            <Flow title="Respond and recover" steps={RECOVERY_FLOW} />
          </div>
        </section>
      </div>
    </>
  );
}
