import { API_BASE_PATH } from '@/config';

export function toApiPath(routePath: string): string {
  const trimmed = routePath.trim();
  if (!trimmed) {
    throw new Error('API route path is required.');
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (
    normalized === API_BASE_PATH ||
    normalized.startsWith(`${API_BASE_PATH}/`)
  ) {
    return normalized;
  }

  return `${API_BASE_PATH}${normalized}`;
}
