import type {
  ActivityEvent,
  AuditEntry,
  FormSettings,
  FormValues,
  Role,
  StaffMember,
  Ticket,
  Viewer,
} from '../shared/spec';

export interface AppUser extends Viewer {
  allowedBrands: string[];
}

/** Spec §6.5 — the frontend cancels a form request after 15 seconds. */
export const SUBMIT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {}

async function request<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal,
      ...init,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new ApiError('The request timed out after 15 seconds. Please try again.');
    }
    throw new ApiError('Network error. Please check your connection and try again.');
  } finally {
    if (timer) clearTimeout(timer);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `Request failed (${response.status}).`;
    throw new ApiError(message);
  }

  return payload as T;
}

function post<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
}

/* -------------------------------- auth --------------------------------- */

export const api = {
  me: () => request<{ user: AppUser | null }>('/api/auth'),

  register: (payload: { email: string; name: string; brands: string[]; password: string }) =>
    post<{ user: AppUser }>('/api/auth', { action: 'register', ...payload }),

  login: (payload: { email: string; password: string }) =>
    post<{ user: AppUser }>('/api/auth', { action: 'login', ...payload }),

  logout: () => post<{ ok: true }>('/api/auth', { action: 'logout' }),

  updateName: (name: string) =>
    post<{ user: AppUser }>('/api/auth', { action: 'updateName', name }),

  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/auth', { action: 'changePassword', currentPassword, newPassword }),

  /* ------------------------------ tickets ------------------------------ */

  tickets: () => request<{ tickets: Ticket[] }>('/api/tickets'),

  audit: (id: string) =>
    request<{ audit: AuditEntry[] }>(`/api/tickets?audit=${encodeURIComponent(id)}`),

  createTicket: (area: string, data: FormValues) =>
    post<{ ticket: Ticket }>('/api/tickets', { action: 'create', area, data }, SUBMIT_TIMEOUT_MS),

  updateTicket: (payload: {
    id: string;
    op: 'accept' | 'decline' | 'schedule' | 'done' | 'notes';
    declineReason?: string;
    notes?: string;
  }) => post<{ ticket: Ticket }>('/api/tickets', { action: 'update', ...payload }),

  deleteTicket: (id: string) =>
    request<{ ok: true }>(`/api/tickets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /* ------------------------------- admin ------------------------------- */

  staff: () => request<{ staff: StaffMember[] }>('/api/staff'),

  saveStaff: (payload: {
    op: 'create' | 'update' | 'reset';
    email: string;
    name?: string;
    roleId?: string | null;
    isAdmin?: boolean;
  }) => post<{ ok: true }>('/api/staff', payload),

  deleteStaff: (email: string) =>
    request<{ ok: true }>(`/api/staff?email=${encodeURIComponent(email)}`, { method: 'DELETE' }),

  roles: () => request<{ roles: (Role & { protected: boolean })[] }>('/api/roles'),

  saveRole: (payload: { id?: string; name: string; permissions: Role['permissions'] }) =>
    post<{ ok: true; id: string }>('/api/roles', payload),

  deleteRole: (id: string) =>
    request<{ ok: true }>(`/api/roles?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  formSettings: () => request<{ settings: FormSettings }>('/api/forms'),

  saveFormSettings: (area: string, settings: FormSettings[string]) =>
    post<{ ok: true; settings: FormSettings }>('/api/forms', { area, settings }),

  /* ------------------------------ events ------------------------------- */

  events: (since: number) =>
    request<{ events: ActivityEvent[]; now: number }>(`/api/events?since=${since}`),
};
