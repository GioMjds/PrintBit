export enum SessionState {
  IDLE = 'IDLE',
  PAIRING = 'PAIRING',
  ACTIVE = 'ACTIVE',
  ENDING = 'ENDING',
}

export type SessionMode = 'IDLE' | 'PRINT' | 'COPY' | 'SCAN';

export interface PairingRecord {
  pairingId: string;
  pin: string;
  clientIp?: string;
  createdAt: number;
  expiresAt: number;
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'CANCELLED';
  sessionId?: string;
  sessionToken?: string;
}

export interface ActiveCustomerSession {
  sessionId: string;
  sessionToken: string;
  clientIp?: string;
  startedAt: number;
  expiresAt: number;
  lastActivityAt: number;
  selectedMode: SessionMode;
  depositedBalance: number;
  spentBalance: number;
}

export interface PairingRequestResult {
  success: boolean;
  pairingId?: string;
  pin?: string;
  expiresIn?: number;
  error?: string;
  code?: string;
}

export interface PairingVerificationResult {
  success: boolean;
  sessionId?: string;
  sessionToken?: string;
  error?: string;
  code?: string;
}

export interface PairingStatusResult {
  status: SessionState;
  sessionToken?: string;
  portalUrl?: string;
  message?: string;
}
