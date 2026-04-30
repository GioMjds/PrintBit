import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { REDIS_HOST, REDIS_PORT } from '@/config';

const PRICING_ANALYSIS_QUEUE_NAME = 'pricing-analysis-jobs';
const PRICING_ANALYSIS_JOB_NAME = 'analyze-document-pricing';

type QueueJobState =
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

const redisConnection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null,
};

const jobOptions: JobsOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 50,
  removeOnFail: 100,
};

let queue: Queue<PricingAnalysisJobData> | null = null;
let worker: Worker<PricingAnalysisJobData> | null = null;
let processor: PricingAnalysisJobProcessor | null = null;

function getQueue(): Queue<PricingAnalysisJobData> {
  if (!queue) {
    queue = new Queue<PricingAnalysisJobData>(PRICING_ANALYSIS_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: jobOptions,
    });
  }
  return queue;
}

function mapQueueState(raw: string): QueueJobState {
  if (
    raw === 'waiting' ||
    raw === 'active' ||
    raw === 'completed' ||
    raw === 'failed' ||
    raw === 'delayed'
  ) {
    return raw;
  }
  return 'unknown';
}

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
  if (worker) return;
  worker = new Worker<PricingAnalysisJobData>(
    PRICING_ANALYSIS_QUEUE_NAME,
    async (job: Job<PricingAnalysisJobData>) => {
      if (!processor) {
        throw new Error('Pricing analysis processor is not configured.');
      }
      await processor(job.data);
    },
    {
      connection: redisConnection,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, error) => {
    console.error('[pricing-analysis-queue] Worker job failed.', {
      jobId: job?.id ?? null,
      sessionId: job?.data.sessionId ?? null,
      documentId: job?.data.documentId ?? null,
      error: error.message,
    });
  });
}

export async function enqueuePricingAnalysisJob(
  data: Omit<PricingAnalysisJobData, 'requestedAt'>,
): Promise<PricingAnalysisJobEnqueueResult> {
  const currentQueue = getQueue();
  const jobId = data.forceReanalyze
    ? buildForceJobId(data.sessionId, data.documentId)
    : buildStableJobId(data.sessionId, data.documentId);
  const payload: PricingAnalysisJobData = {
    ...data,
    requestedAt: new Date().toISOString(),
  };

  if (!data.forceReanalyze) {
    const existingJob = await currentQueue.getJob(jobId);
    if (existingJob) {
      const existingState = mapQueueState(await existingJob.getState());
      if (
        existingState === 'waiting' ||
        existingState === 'active' ||
        existingState === 'delayed'
      ) {
        return {
          jobId,
          status: existingState,
        };
      }
    }
  }

  const job = await currentQueue.add(PRICING_ANALYSIS_JOB_NAME, payload, {
    jobId,
  });
  const queuedState = mapQueueState(await job.getState());
  return {
    jobId: String(job.id),
    status: queuedState,
  };
}

export async function getPricingAnalysisJobStatus(
  jobId: string,
): Promise<PricingAnalysisJobStatusResult> {
  const currentQueue = getQueue();
  const job = await currentQueue.getJob(jobId);
  if (!job) {
    return { jobId, status: 'unknown' };
  }
  const state = mapQueueState(await job.getState());
  const failedReason =
    typeof job.failedReason === 'string' ? job.failedReason : null;
  return {
    jobId,
    status: state,
    failedReason,
  };
}

