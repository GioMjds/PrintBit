export type KioskSessionState = 'IDLE' | 'PAIRING' | 'ACTIVE' | 'ENDING';

export enum SessionState {
  IDLE = 'IDLE',
  PAIRING = 'PAIRING',
  ACTIVE = 'ACTIVE',
  ENDING = 'ENDING',
}

export type SessionMode = 'IDLE' | 'PRINT' | 'COPY' | 'SCAN';

export type PairingStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface PairingRecord {
  pairingId: string;
  pin: string;
  clientIp?: string;
  createdAt: number;
  expiresAt: number;
  status: PairingStatus;
  sessionId?: string;
  sessionToken?: string;
}

export type PairingRequestRecord = PairingRecord;

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

export type PairingRequestResult =
  | { pairingId: string; pin: string; expiresIn: number }
  | { error: 'KIOSK_BUSY' };

export interface PairingVerificationResult {
  success: boolean;
  sessionId?: string;
  sessionToken?: string;
  error?: string;
}

export interface PairingStatusResult {
  status: PairingStatus;
  sessionToken?: string;
  portalUrl?: string;
  message?: string;
}

export interface CoinCreditResult {
  accepted: boolean;
  newBalance: number;
}

export interface SessionRefundResult {
  refunded: number;
  success: boolean;
}

