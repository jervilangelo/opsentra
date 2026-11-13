import { ArrowDown } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Static view of the system as built (blueprint §3.1–3.2; ADR-014 to ADR-020). */
const PLANES = [
  {
    name: 'Frontend',
    scope: 'Static GitHub Pages build: Demo Mode with synthetic data, Live Mode through the API',
    posture: 'No AWS credentials; strict Content Security Policy; public config only',
    lifetime: 'Persistent',
  },
  {
    name: 'Control plane',
    scope:
      'Cognito, API Gateway, 5 Lambdas (API, ingest, reconciler, coordinator, lab controller), DynamoDB, EventBridge, SNS, CloudWatch dashboard',
    posture: 'JWT on every route, backend role checks, least-privilege IAM',
    lifetime: 'Deployed in ap-southeast-1',
  },
  {
    name: 'Lab plane',
    scope: 'Disposable EC2/Nginx, its health-probe Lambda and alarm, and two fixed SSM documents',
    posture: 'Tagged opsentra:lab=true, hash-pinned documents, self-terminating, teardown verified',
    lifetime: 'Created only for a demo or test',
  },
  {
    name: 'Terraform state',
    scope: 'Dedicated versioned, encrypted S3 bucket with native lockfile',
    posture: 'Never public',
    lifetime: 'Persistent',
  },
];

const DETECTION_FLOW = [
  'Health-check Lambda probes the Nginx lab every minute',
  'CloudWatch alarm enters ALARM after 3 failed probes',
  'EventBridge rule routes the alarm state change',
  'Incident ingest Lambda writes a deduplicated incident to DynamoDB (one email alert)',
  'Dashboard reads it through the authenticated API',
];

const RECOVERY_FLOW = [
  'Operator requests an allowlisted runbook',
  'Administrator approves (identity, reason and correlation ID audited)',
  'Coordinator runs the hash-pinned SSM document once, on the tagged lab instance only',
  'Three healthy probes after the fix, with the alarm OK',
  'Incident is marked RESOLVED only after that verification; otherwise ESCALATED',
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
            As built · control plane deployed, lab on demand
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
        <section aria-labelledby="scope-heading" className="flex flex-col gap-3">
          <h2 id="scope-heading" className="text-lg">
            What runs where
          </h2>
          <Card>
            <CardContent className="pt-6 text-sm">
              <ul className="flex flex-col gap-2">
                <li>
                  <span className="font-medium">Live and Demo:</span> Scenario A (Nginx outage),
                  incidents, approved remediation, verified recovery, audit, analytics, reports.
                </li>
                <li>
                  <span className="font-medium">Demo only:</span> Scenario B (Lambda regression and
                  rollback) and Scenario C (security group exposure).
                </li>
                <li>
                  <span className="font-medium">Not built:</span> printable HTML reports, tracing,
                  multi-account or multi-region operation.
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
