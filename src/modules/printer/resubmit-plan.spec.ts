import { computeResubmitPlan, type ResubmitPlan } from './resubmit-plan';

describe('computeResubmitPlan', () => {
  describe('partial (the canonical "resume missing pages" case)', () => {
    it('returns pages 6-10 when 5 of 10 pages have been printed', () => {
      const plan: ResubmitPlan = computeResubmitPlan(5, 10);
      expect(plan).toEqual({ kind: 'partial', pageRange: '6-10' });
    });

    it('returns the last single page when only the first page printed', () => {
      const plan: ResubmitPlan = computeResubmitPlan(1, 5);
      expect(plan).toEqual({ kind: 'partial', pageRange: '2-5' });
    });

    it('returns page 2 when only page 1 of a 2-page document printed', () => {
      const plan: ResubmitPlan = computeResubmitPlan(1, 2);
      expect(plan).toEqual({ kind: 'partial', pageRange: '2-2' });
    });

    it('returns the full document when pagesPrinted is negative (worker reset state)', () => {
      // Defensive: a worker bug that emitted pagesPrinted < 0 should not
      // crash the resume path. Treat negative progress as "reprint from
      // page 1" — the partial arm with a 1-N range.
      const plan: ResubmitPlan = computeResubmitPlan(-1, 10);
      expect(plan).toEqual({ kind: 'partial', pageRange: '1-10' });
    });
  });

  describe('no_resubmit', () => {
    it('returns no_resubmit when pagesPrinted equals totalPages', () => {
      const plan: ResubmitPlan = computeResubmitPlan(10, 10);
      expect(plan).toEqual({ kind: 'no_resubmit' });
    });

    it('returns no_resubmit when pagesPrinted exceeds totalPages (driver over-count)', () => {
      // The L5290 driver can report `pagesPrinted > totalPages` if its
      // counters drift. Don't try to print a negative range — just say
      // we're done.
      const plan: ResubmitPlan = computeResubmitPlan(11, 10);
      expect(plan).toEqual({ kind: 'no_resubmit' });
    });
  });

  describe('full (worker reported 0/N — printer refused the job)', () => {
    it('returns full when pagesPrinted is 0 and totalPages is 10', () => {
      // Genuine "nothing printed" — printer rejected the job. The previous
      // bug had this also returning 'full' for the null/null case, which
      // made it impossible to distinguish "nothing printed" from "no
      // progress info at all". Now 'full' is reserved for the genuine
      // case; 'unknown' covers the null/NaN/zero-total cases.
      const plan: ResubmitPlan = computeResubmitPlan(0, 10);
      expect(plan).toEqual({ kind: 'full' });
    });
  });

  describe('unknown (the regression case — no progress info)', () => {
    it('returns unknown when both pagesPrinted and totalPages are null', () => {
      // This is the EPSON L5290 paper-out case: the spooler purged the
      // job before the worker ever published a progress snapshot. The
      // caller MUST treat this as an error and surface "please re-upload"
      // rather than reprinting the full document.
      const plan: ResubmitPlan = computeResubmitPlan(null, null);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when only pagesPrinted is null', () => {
      const plan: ResubmitPlan = computeResubmitPlan(null, 10);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when only totalPages is null', () => {
      const plan: ResubmitPlan = computeResubmitPlan(5, null);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when pagesPrinted is NaN', () => {
      const plan: ResubmitPlan = computeResubmitPlan(Number.NaN, 10);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when totalPages is NaN', () => {
      const plan: ResubmitPlan = computeResubmitPlan(5, Number.NaN);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when totalPages is 0', () => {
      const plan: ResubmitPlan = computeResubmitPlan(5, 0);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when totalPages is negative', () => {
      const plan: ResubmitPlan = computeResubmitPlan(5, -1);
      expect(plan).toEqual({ kind: 'unknown' });
    });

    it('returns unknown when pagesPrinted is Infinity', () => {
      const plan: ResubmitPlan = computeResubmitPlan(Number.POSITIVE_INFINITY, 10);
      expect(plan).toEqual({ kind: 'unknown' });
    });
  });
});
