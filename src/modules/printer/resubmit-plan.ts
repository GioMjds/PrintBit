/**
 * Pure helper that translates a (pagesPrinted, totalPages) snapshot from
 * the spooler lifecycle into a structured "what should the resume path
 * do next" plan.
 *
 * Extracted from `printer.service.ts` into its own module so that it can
 * be unit-tested without booting the entire printer service (db,
 * services, config, etc.). The printer service consumes the result;
 * no other caller should reach for it directly.
 *
 * Plan arms:
 * - `no_resubmit`: lifecycle shows all pages already printed; nothing to do.
 * - `partial`: print only the unprinted tail of the prepared PDF.
 * - `full`: the worker explicitly reported `pagesPrinted=0/totalPages=N`
 *   (the printer refused the job outright; nothing was ever printed), so
 *   a full reprint is correct.
 * - `unknown`: no progress info available — null/null, NaN, or totalPages <= 0.
 *   This is the EPSON L5290 paper-out case where the spooler purged the
 *   job without the worker ever publishing a progress snapshot. The caller
 *   MUST treat `unknown` as an error and surface a "please re-upload"
 *   message to the user; silently falling through to a full reprint is
 *   the original pause/resume bug.
 *
 * The pageRange string is in the same coordinate space the worker uses
 * for `pageRange` in the sidecar (1-indexed positions within the
 * prepared PDF).
 */
export type ResubmitPlan =
  | { kind: 'no_resubmit' }
  | { kind: 'partial'; pageRange: string }
  | { kind: 'full' }
  | { kind: 'unknown' };

export function computeResubmitPlan(
  pagesPrinted: number | null,
  totalPages: number | null,
): ResubmitPlan {
  if (pagesPrinted === null || totalPages === null) return { kind: 'unknown' };
  if (!Number.isFinite(pagesPrinted) || !Number.isFinite(totalPages)) {
    return { kind: 'unknown' };
  }
  if (totalPages <= 0) return { kind: 'unknown' };
  if (pagesPrinted >= totalPages) return { kind: 'no_resubmit' };
  // The worker explicitly reported 0 of N — the printer refused the job
  // outright and nothing was ever printed. A full reprint is correct here,
  // and is the only path that returns `kind: 'full'` from this function.
  if (pagesPrinted === 0) {
    return { kind: 'full' };
  }
  if (pagesPrinted < 0) {
    return { kind: 'partial', pageRange: `1-${totalPages}` };
  }
  return {
    kind: 'partial',
    pageRange: `${pagesPrinted + 1}-${totalPages}`,
  };
}
