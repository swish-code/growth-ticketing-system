import type { RequestEligibility } from '../../shared/spec';
import { eligibilityBlockedMessage, eligibilitySummary, formatDateTime } from '../lib/format';
import { IconAlert, IconCheck } from './Icons';
import './eligibility.css';

/**
 * Shows the request-frequency cooldown state (spec: request frequency
 * rules) — the requester's last request in this tab, when they're next
 * allowed to submit, and why they're blocked if they are.
 */
export function EligibilityBanner({
  eligibility,
  tabLabel,
  compact = false,
}: {
  eligibility: RequestEligibility | null;
  tabLabel: string;
  /** Compact: one line for the tab page header. Full: detailed card inside the form. */
  compact?: boolean;
}) {
  if (!eligibility) return null;

  if (compact) {
    return (
      <p className={`eligibility-line ${eligibility.eligible ? '' : 'is-blocked'}`}>
        {eligibility.eligible ? <IconCheck size={15} /> : <IconAlert size={15} />}
        <span>{eligibilitySummary(eligibility)}</span>
      </p>
    );
  }

  if (eligibility.eligible) {
    return (
      <div className="eligibility-card is-ok">
        <IconCheck size={17} />
        <div>
          <strong>You're eligible to submit.</strong>
          <p className="muted small">
            {eligibility.lastRequestAt === null
              ? `This will be your first ${tabLabel} request.`
              : `Last request: ${formatDateTime(eligibility.lastRequestAt)}.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="eligibility-card is-blocked">
      <IconAlert size={17} />
      <div>
        <strong>You can't submit a new {tabLabel} request yet.</strong>
        <p className="small">{eligibilityBlockedMessage(eligibility, tabLabel)}</p>
      </div>
    </div>
  );
}
