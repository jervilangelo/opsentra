import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BrandSymbol } from './brand/BrandSymbol';
import { Timestamp } from './data/Timestamp';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { LoadingState, PlannedPanel } from './feedback/states';
import { DEMO_LABEL, LIVE_LABEL, ModeBadge } from './mode/ModeBadge';

describe('ModeBadge', () => {
  it('uses the standard labels', () => {
    expect(DEMO_LABEL).toBe('DEMO — SYNTHETIC DATA');
    expect(LIVE_LABEL).toBe('LIVE AWS — ap-southeast-1');
  });

  it('demo badge is dashed, live badge is solid with a dot', () => {
    const { rerender, container } = render(<ModeBadge mode="demo" />);
    expect(container.firstElementChild?.className).toMatch(/border-dashed/);
    rerender(<ModeBadge mode="live" />);
    expect(container.firstElementChild?.className).not.toMatch(/border-dashed/);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('BrandSymbol', () => {
  it('uses the small-size cut below 32 px and the master cut otherwise', () => {
    const { container, rerender } = render(<BrandSymbol size={24} />);
    expect(container.querySelector('svg')?.dataset.cut).toBe('small');
    rerender(<BrandSymbol size={32} />);
    expect(container.querySelector('svg')?.dataset.cut).toBe('master');
  });

  it('only animates under motion-safe, and never rotates', () => {
    render(<BrandSymbol shifting />);
    const right = screen.getByTestId('brand-shift');
    expect(right.getAttribute('class')).toBe('motion-safe:animate-ops-shift');
    expect(right.getAttribute('class')).not.toMatch(/spin|rotate/);
  });
});

describe('LoadingState', () => {
  it('is announced politely', () => {
    render(<LoadingState label="Loading incidents…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading incidents…');
  });
});

describe('PlannedPanel', () => {
  it('is clearly labelled as planned', () => {
    render(<PlannedPanel phase="Phase 6" title="Live remediation" />);
    expect(screen.getByText('Planned · Phase 6')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live remediation (planned)' })).toBeInTheDocument();
  });
});

describe('Timestamp', () => {
  it('keeps the UTC source in dateTime', () => {
    render(<Timestamp value="2026-11-10T03:14:05Z" />);
    const time = document.querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe('2026-11-10T03:14:05Z');
    expect(time?.getAttribute('title')).toContain('UTC');
  });

  it('shows missing values as not recorded, never as zero', () => {
    render(<Timestamp value={undefined} />);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('names the action, resource and environment and waits for onConfirm', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        action="Restart Nginx"
        resource="i-0demo7c1a2e9b4f01"
        environment="lab · ap-southeast-1"
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Restart Nginx');
    expect(dialog).toHaveTextContent('i-0demo7c1a2e9b4f01');
    expect(dialog).toHaveTextContent('lab · ap-southeast-1');

    await user.click(screen.getByRole('button', { name: 'Restart Nginx' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const pending = screen.getByRole('button', { name: 'Waiting for confirmation…' });
    expect(pending).toBeDisabled();
    resolve();
    expect(await screen.findByRole('button', { name: 'Restart Nginx' })).toBeEnabled();
  });
});
