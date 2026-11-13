import {
  ArrowRight,
  BellRing,
  ChevronRight,
  ShieldCheck,
  Star,
  Stethoscope,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router';

import { BrandSymbol } from '@/components/brand/BrandSymbol';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';

import { REPO_URL, stagger } from './site';

const TAGLINE = ['Monitor.', 'Detect.', 'Respond.', 'Recover.'];

const LIFECYCLE = [
  'Failure',
  'Detection',
  'Incident',
  'Approval',
  'Remediation',
  'Verified recovery',
];

const FEATURES = [
  {
    icon: BellRing,
    title: 'Detect',
    text: 'An independent probe checks the service every minute. A CloudWatch alarm becomes one deduplicated incident, with evidence and a timeline.',
  },
  {
    icon: Wrench,
    title: 'Respond',
    text: 'An operator requests an allowlisted runbook; an administrator approves it; it runs exactly once, on the tagged lab instance only. Every step is audited.',
  },
  {
    icon: Stethoscope,
    title: 'Verify',
    text: '“Success” from a command is not recovery. An incident is resolved only after independent health checks pass, or it escalates.',
  },
];

export function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-12rem] left-1/2 -z-10 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--brand-symbol)_28%,transparent),transparent)] blur-2xl motion-safe:animate-glow-drift"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--border)_55%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--border)_55%,transparent)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black_35%,transparent_75%)] bg-[size:48px_48px]"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-7 px-4 pt-20 pb-16 text-center sm:pt-28">
          <div className="animate-fade-up" style={stagger(0)}>
            <BrandSymbol
              size={112}
              className="motion-safe:[&>path:last-child]:animate-ops-shift-intro"
            />
          </div>
          <h1 id="hero-title" className="animate-fade-up" style={stagger(1, 120)}>
            <Logo height={64} className="justify-center" />
          </h1>
          <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {TAGLINE.map((word, i) => (
              <span key={word} className="animate-fade-up" style={stagger(i, 160, 350)}>
                {word}
              </span>
            ))}
          </p>
          <p
            className="max-w-2xl animate-fade-up text-lg text-muted-foreground"
            style={stagger(0, 0, 1100)}
          >
            A UI-first cloud operations and incident response platform for AWS: watch a workload,
            detect an outage, and run an approved, audited recovery from one web app.
          </p>
          <div
            className="flex animate-fade-up flex-wrap justify-center gap-3"
            style={stagger(0, 0, 1250)}
          >
            <Button asChild size="lg">
              <Link to="/overview" className="no-underline">
                Explore the live demo
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="group">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <Star
                  className="group-hover:animate-twinkle group-hover:fill-primary group-hover:text-primary"
                  aria-hidden="true"
                />
                Star on GitHub
                <span className="sr-only">(opens GitHub in a new tab)</span>
              </a>
            </Button>
          </div>
          <p className="animate-fade-up text-sm text-muted-foreground" style={stagger(0, 0, 1400)}>
            No sign-in needed. The demo uses synthetic data, clearly labelled; Live AWS Mode needs
            an account.
          </p>
        </div>
      </section>

      {/* Lifecycle */}
      <section aria-labelledby="lifecycle-title" className="border-y bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h2 id="lifecycle-title" className="sr-only">
            The incident lifecycle
          </h2>
          <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-sm sm:text-base">
            {LIFECYCLE.map((step, i) => (
              <li
                key={step}
                className="flex animate-fade-up items-center gap-2"
                style={stagger(i, 110, 1500)}
              >
                <span
                  className={
                    i === LIFECYCLE.length - 1
                      ? 'rounded-full border border-status-healthy/60 px-3 py-1 font-medium'
                      : 'rounded-full border px-3 py-1'
                  }
                >
                  {step}
                </span>
                {i < LIFECYCLE.length - 1 ? (
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-title" className="mx-auto max-w-6xl px-4 py-16">
        <h2 id="features-title" className="mb-8 text-center text-2xl font-semibold">
          Built around one rule: recovery must be proven
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <article
              key={title}
              className="animate-fade-up rounded-lg border bg-card p-6 transition-colors hover:border-primary/60"
              style={stagger(i, 120, 1700)}
            >
              <Icon className="mb-3 size-6 text-primary" aria-hidden="true" />
              <h3 className="mb-2 text-lg font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Built with Terraform on AWS: Cognito, API Gateway, Lambda, DynamoDB, EventBridge,
            CloudWatch and Systems Manager.
          </p>
          <Link to="/about" className="text-sm underline">
            Who built this, and why
          </Link>
        </div>
      </section>
    </>
  );
}
