import type {
  AdminLockout,
  AdminSettings,
  CoinStats,
  JobStats,
  HopperSettings,
  HopperStats,
  OwedChangeEntry,
  AdminLogEntry,
  FeedbackEntry,
  FeedbackSessionEntry,
  ReportIssueEntry,
  ReportIssueSessionEntry,
  ReportIssueAttachmentEntry,
  PendingRefundEntry,
} from './types';

export type Schema = {
  adminLockout: AdminLockout;
  balance: number;
  earnings: number;
  settings: AdminSettings;
  coinStats: CoinStats;
  jobStats: JobStats;
  hopperSettings: HopperSettings;
  hopperStats: HopperStats;
  owedChanges: OwedChangeEntry[];
  logs: AdminLogEntry[];
  feedback: FeedbackEntry[];
  feedbackSessions: FeedbackSessionEntry[];
  reportIssues: ReportIssueEntry[];
  reportIssueSessions: ReportIssueSessionEntry[];
  reportIssueAttachments: ReportIssueAttachmentEntry[];
  pendingRefunds: PendingRefundEntry[];
};
