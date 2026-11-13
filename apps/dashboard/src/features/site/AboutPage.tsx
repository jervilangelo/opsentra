import { ArrowRight, Award, ExternalLink, Star } from 'lucide-react';
import { Link } from 'react-router';

import { BrandSymbol } from '@/components/brand/BrandSymbol';
import { Button } from '@/components/ui/button';

import { AUTHOR_NAME, AUTHOR_URL, REPO_URL, stagger } from './site';

/** How the build exercises the four CLF-C02 exam domains. */
const DOMAINS = [
  {
    domain: 'Cloud concepts',
    practice:
      'Serverless and on-demand by design: no always-on servers, a disposable lab created only for tests, and Infrastructure as Code with Terraform.',
  },
  {
    domain: 'Security and compliance',
    practice:
      'IAM least privilege pinned by tests, Cognito sign-in with roles enforced by the backend, an append-only audit trail and encrypted, private Terraform state.',
  },
  {
    domain: 'Cloud technology and services',
    practice:
      'EC2, Lambda, API Gateway, DynamoDB, EventBridge, CloudWatch, SNS, SQS and Systems Manager, all working together in one incident workflow.',
  },
  {
    domain: 'Billing, pricing and support',
    practice:
      'Cost guardrails (no NAT gateways, load balancers or always-on compute), a measured cost log, and a lab that expires on its own.',
  },
];

export function AboutPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-16">
      <header className="flex animate-fade-up flex-col items-start gap-4">
        <BrandSymbol
          size={56}
          className="motion-safe:[&>path:last-child]:animate-ops-shift-intro"
        />
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">About Opsentra</h1>
      </header>

      <section
        aria-labelledby="author-title"
        className="flex animate-fade-up flex-col gap-4 text-lg leading-relaxed"
        style={stagger(1, 120)}
      >
        <h2 id="author-title" className="sr-only">
          Who made it
        </h2>
        <p>
          Opsentra is designed and built by <strong>{AUTHOR_NAME}</strong>: the concept,
          architecture, brand, infrastructure and code.
        </p>
        <p className="flex items-start gap-3">
          <Award className="mt-1.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            I made it to keep what I learned for my recent certification,{' '}
            <strong>AWS Certified Cloud Practitioner (CLF-C02)</strong>, fresh, by putting it to
            work on a real project instead of letting it fade after the exam.
          </span>
        </p>
        <p>
          Find out more about me at{' '}
          <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="underline">
            jervilangelo.online
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="domains-title" className="flex flex-col gap-4">
        <h2
          id="domains-title"
          className="animate-fade-up text-xl font-semibold"
          style={stagger(2, 120)}
        >
          The CLF-C02 domains, in practice
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {DOMAINS.map(({ domain, practice }, i) => (
            <li
              key={domain}
              className="animate-fade-up rounded-lg border bg-card p-5"
              style={stagger(i, 100, 400)}
            >
              <h3 className="mb-1.5 font-semibold">{domain}</h3>
              <p className="text-sm text-muted-foreground">{practice}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Links"
        className="flex animate-fade-up flex-wrap gap-3"
        style={stagger(0, 0, 850)}
      >
        <Button asChild>
          <Link to="/overview" className="no-underline">
            Explore the demo
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="group">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            <Star className="group-hover:animate-twinkle" aria-hidden="true" />
            Star on GitHub
            <span className="sr-only">(opens GitHub in a new tab)</span>
          </a>
        </Button>
        <Button asChild variant="ghost">
          <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
            jervilangelo.online
            <ExternalLink aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </section>
    </div>
  );
}
