/**
 * Marks a recovery approved by the same administrator who requested it. Allowed
 * by the owner's policy (ADR-017) but always visible, never colour alone.
 */
export function SelfApprovedNote() {
  return (
    <span
      className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
      title="Requested and approved by the same administrator"
    >
      Self-approved
    </span>
  );
}
