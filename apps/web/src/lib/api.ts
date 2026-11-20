import type { BranchDto, HealthResponse } from '@sms/shared';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<HealthResponse>('/health'),
  branches: () => get<BranchDto[]>('/branches'),
};
