export const PRINT_PAGE_WARNING_THRESHOLD = 30;

export function formatPrintSessionLimitNote(): string {
  return 'Print limit: A maximum of 30 pages can be printed in this session. Your selected page range multiplied by copies must stay within 30 pages.';
}

export function isLargePrintDocument(pageCount: unknown): pageCount is number {
  return (
    typeof pageCount === 'number' &&
    Number.isFinite(pageCount) &&
    pageCount >= PRINT_PAGE_WARNING_THRESHOLD
  );
}

export function formatLargePrintDisclaimer(pageCount: number): string {
  return `Print-only notice: This kiosk allows a maximum of 30 printed pages per session. Your document contains ${pageCount} pages. If you print more than 30 pages or use copies that exceed 30 total pages, choose a smaller page range or fewer copies. Review the page range, copies, and total price before continuing. This limit applies only to Print and this session.`;
}
