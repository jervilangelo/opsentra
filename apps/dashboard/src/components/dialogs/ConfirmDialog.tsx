import { useId, useState } from 'react';

import { MonoId } from '@/components/data/MonoId';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human-readable action, e.g. "Restart Nginx". */
  action: string;
  /** The exact target resource ID. */
  resource: string;
  /** Environment name shown to the user, e.g. "lab · ap-southeast-1". */
  environment: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** When set, a non-empty reason is required and passed to onConfirm. */
  reasonLabel?: string;
  /** Editable starting text for the reason (Easy view). Still required and audited. */
  defaultReason?: string;
  /** Error from the last attempt, shown inside the dialog. */
  error?: string | undefined;
  /**
   * Called on confirm. The dialog stays open, with the button disabled, until
   * the promise settles; callers close it only after the backend confirms.
   */
  onConfirm: (reason: string) => Promise<void> | void;
  children?: React.ReactNode;
}

/**
 * Critical-action confirmation (blueprint §2.3): always names the resource,
 * environment and action. No single-click destructive commands.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  action,
  resource,
  environment,
  description,
  confirmLabel,
  destructive = false,
  reasonLabel,
  defaultReason = '',
  error,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState(defaultReason);
  const reasonId = useId();
  const needsReason = Boolean(reasonLabel);
  const blocked = pending || (needsReason && reason.trim() === '');

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) setReason(defaultReason);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm: {action}</DialogTitle>
          <DialogDescription>
            {description ?? 'Review the exact target before you continue.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
          <dt className="text-muted-foreground">Action</dt>
          <dd>{action}</dd>
          <dt className="text-muted-foreground">Resource</dt>
          <dd>
            <MonoId>{resource}</MonoId>
          </dd>
          <dt className="text-muted-foreground">Environment</dt>
          <dd>{environment}</dd>
        </dl>
        {children}
        {needsReason ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={reasonId} className="text-sm font-medium">
              {reasonLabel} <span className="text-muted-foreground">(required)</span>
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={280}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-status-critical">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void handleConfirm()}
            disabled={blocked}
            aria-busy={pending}
          >
            {pending ? 'Waiting for confirmation…' : (confirmLabel ?? action)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
