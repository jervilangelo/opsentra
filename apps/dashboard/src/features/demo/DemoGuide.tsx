import { CircleCheck, Circle, CircleDot } from 'lucide-react';
import { Link } from 'react-router';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useDemoSession } from '@/modes/demo/demo-store';

import { guideSteps } from './guide-steps';

export function DemoGuide({ className }: { className?: string }) {
  const engine = useDemoSession((s) => s.engine);
  const steps = guideSteps(engine);
  const current = steps.findIndex((s) => !s.done);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Guided demo: Detect → Investigate → Approve → Recover</CardTitle>
        <CardDescription>
          A scripted walkthrough with synthetic data. Nothing here touches AWS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2" aria-label="Demo walkthrough progress">
          {steps.map((step, idx) => {
            const isCurrent = idx === current;
            const Icon = step.done ? CircleCheck : isCurrent ? CircleDot : Circle;
            return (
              <li
                key={step.title}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn('flex gap-3 rounded-md px-2 py-1.5', isCurrent && 'bg-accent')}
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    step.done
                      ? 'text-status-healthy'
                      : isCurrent
                        ? 'text-primary'
                        : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    <span className="sr-only">
                      {step.done ? 'Done: ' : isCurrent ? 'Current step: ' : 'To do: '}
                    </span>
                    {step.to && (isCurrent || step.done) ? (
                      <Link to={step.to}>{step.title}</Link>
                    ) : (
                      step.title
                    )}
                  </span>
                  {isCurrent ? (
                    <span className="text-xs text-muted-foreground">{step.hint}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
