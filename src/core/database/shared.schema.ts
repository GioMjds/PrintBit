/**
 * Shared schema types used across multiple modules.
 */

export type PrintMode = 'print' | 'copy' | 'scan';
export type ColorMode = 'colored' | 'grayscale';
export type SupportedLanguage = 'en' | 'fil';

export type LogMeta = Record<string, string | number | boolean | null>;

export type TrustedTimestampSource = 'ntp' | 'system';

export interface TrustedTimestampMeta {
  source: TrustedTimestampSource;
  synced: boolean;
  offsetMs: number | null;
  detail: string | null;
}

export interface CoinStats {
  one: number;
  five: number;
  ten: number;
  twenty: number;
}

export interface JobStats {
  total: number;
  print: number;
  copy: number;
  scan: number;
}
