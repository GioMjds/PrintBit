export type PrinterErrorCode =
  | 'paper_out'
  | 'manual_feed_required'
  | 'paper_jam'
  | 'offline'
  | 'usb_disconnected'
  | 'ink_empty'
  | 'ink_low'
  | 'door_open'
  | 'user_intervention'
  | 'scanner_no_document'
  | 'scanner_paper_jam'
  | 'unknown';

export interface PrinterFaultDescriptor {
  code: PrinterErrorCode;
  severity: 'warning' | 'critical';
  userTitle: string;
  userBody: string;
  recoveryHint: string;
  requiresAdminAction: boolean;
}