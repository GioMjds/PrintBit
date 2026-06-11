import { randomUUID } from 'node:crypto';

const PRICING_ANALYSIS_JOB_NAME = 'analyze-document-pricing';

export type QueueJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'unknown';

export interface PricingAnalysisJobData {
  sessionId: string;
  documentId: string;
  forceReanalyze: boolean;
  source: 'upload' | 'manual';
  requestedAt: string;
}

export interface PricingAnalysisJobEnqueueResult {
  jobId: string;
  status: QueueJobState;
}

export interface PricingAnalysisJobStatusResult {
  jobId: string;
  status: QueueJobState;
  failedReason?: string | null;
}

type PricingAnalysisJobProcessor = (
  data: PricingAnalysisJobData,
) => Promise<void>;

interface LocalJob {
  id: string;
  data: PricingAnalysisJobData;
  state: QueueJobState;
  failedReason?: string | null;
}

const jobStore = new Map<string, LocalJob>();
const queue: string[] = [];
let processor: PricingAnalysisJobProcessor | null = null;
let isProcessing = false;

function buildStableJobId(sessionId: string, documentId: string): string {
  return `${sessionId}:${documentId}`;
}

function buildForceJobId(sessionId: string, documentId: string): string {
  return `${sessionId}:${documentId}:force:${randomUUID()}`;
}

export function setPricingAnalysisJobProcessor(
  nextProcessor: PricingAnalysisJobProcessor,
): void {
  processor = nextProcessor;
}

export function startPricingAnalysisWorker(): void {
  // Local worker doesn't need explicit start, it's triggered by enqueue
  console.info('[pricing-analysis-queue] Local worker initialized');
}

export async function enqueuePricingAnalysisJob(
  data: Omit<PricingAnalysisJobData, 'requestedAt'>,
): Promise<PricingAnalysisJobEnqueueResult> {
  const jobId = data.forceReanalyze
    ? buildForceJobId(data.sessionId, data.documentId)
    : buildStableJobId(data.sessionId, data.documentId);
  
  const payload: PricingAnalysisJobData = {
    ...data,
    requestedAt: new Date().toISOString(),
  };

  if (!data.forceReanalyze) {
    const existing = jobStore.get(jobId);
    if (existing && (existing.state === 'waiting' || existing.state === 'active')) {
      return { jobId, status: existing.state };
    }
  }

  const job: LocalJob = {
    id: jobId,
    data: payload,
    state: 'waiting',
  };

  jobStore.set(jobId, job);
  queue.push(jobId);

  // Trigger processing
  processNext().catch((err) => {
    console.error('[pricing-analysis-queue] Processing loop failed', err);
  });

  return { jobId, status: 'waiting' };
}

async function processNext(): Promise<void> {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  try {
    while (queue.length > 0) {
      const jobId = queue.shift();
      if (!jobId) continue;

      const job = jobStore.get(jobId);
      if (!job) continue;

      job.state = 'active';

      try {
        if (!processor) {
          throw new Error('Pricing analysis processor is not configured.');
        }
        await processor(job.data);
        job.state = 'completed';
      } catch (err) {
        console.error(`[pricing-analysis-queue] Job ${jobId} failed:`, err);
        job.state = 'failed';
        job.failedReason = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    isProcessing = false;
  }
}

export async function getPricingAnalysisJobStatus(
  jobId: string,
): Promise<PricingAnalysisJobStatusResult> {
  const job = jobStore.get(jobId);
  if (!job) {
    return { jobId, status: 'unknown' };
  }
  return {
    jobId,
    status: job.state,
    failedReason: job.failedReason,
  };
}
