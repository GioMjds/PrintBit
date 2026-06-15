import { analyzeDocument } from '../src/services/document-analysis';
import {
  initSqliteStorage,
  feedbackStore,
  reportIssueStore,
} from '../src/core/database/sqlite-storage';
import { randomUUID } from 'node:crypto';

describe('Document Analysis Bug Verification', () => {
  // List the bugs you may find all throughout development here as test cases to verify they are fixed and do not regress.
  it('should be able to import the service', () => {
    expect(analyzeDocument).toBeDefined();
  });
});

describe('Database Submission Idempotency Verification', () => {
  beforeAll(() => {
    initSqliteStorage();
  });

  it('should reject duplicate feedback submissions for the same session', () => {
    const sessionId = randomUUID();
    const token = randomUUID();
    
    // Create session
    feedbackStore.createSession({
      id: sessionId,
      token,
      feedbackUrl: `http://localhost/feedback/${token}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      submittedAt: null,
    });

    const feedbackEntry1 = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      comment: 'Excellent service!',
      category: 'service' as const,
      rating: 5,
      status: 'open' as const,
    };

    // First submission should succeed
    expect(() => {
      feedbackStore.createFeedbackSubmission(feedbackEntry1);
    }).not.toThrow();

    // Verify session is marked submitted
    const session = feedbackStore.getSessionByToken(token);
    expect(session).not.toBeNull();
    expect(session?.submittedAt).not.toBeNull();

    const feedbackEntry2 = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      comment: 'Wait, let me change my rating.',
      category: 'service' as const,
      rating: 4,
      status: 'open' as const,
    };

    // Second submission should fail
    expect(() => {
      feedbackStore.createFeedbackSubmission(feedbackEntry2);
    }).toThrow(/already submitted/);
  });

  it('should reject duplicate report issue submissions for the same session', () => {
    const sessionId = randomUUID();
    const token = randomUUID();

    // Create session
    reportIssueStore.createSession({
      id: sessionId,
      token,
      reportUrl: `http://localhost/report/${token}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      submittedAt: null,
    });

    const issueEntry1 = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      title: 'Printer Jammed',
      description: 'Paper is jammed in tray 2',
      category: 'hardware' as const,
      status: 'open' as const,
      attachmentIds: [],
      acknowledgedAt: null,
      resolvedAt: null,
    };

    // First submission should succeed
    expect(() => {
      reportIssueStore.createSessionIssueWithAttachments(issueEntry1);
    }).not.toThrow();

    // Verify session is marked submitted
    const session = reportIssueStore.getSessionByToken(token);
    expect(session).not.toBeNull();
    expect(session?.submittedAt).not.toBeNull();

    const issueEntry2 = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      title: 'Printer Jammed again',
      description: 'Still jammed',
      category: 'hardware' as const,
      status: 'open' as const,
      attachmentIds: [],
      acknowledgedAt: null,
      resolvedAt: null,
    };

    // Second submission should fail
    expect(() => {
      reportIssueStore.createSessionIssueWithAttachments(issueEntry2);
    }).toThrow(/already submitted/);
  });
});
