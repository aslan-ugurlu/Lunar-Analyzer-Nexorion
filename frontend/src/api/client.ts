import type {
  AnalysisInput,
  ApiErrorBody,
  CompareResponse,
  Health,
  Horizon,
  JobRecord,
  Priority,
  QueuedResponse,
  SitesResponse,
  TimelineResponse,
  ValidationResponse,
} from './types';

import { defineStrings, pick } from '../i18n';

const CLIENT_STR = defineStrings({
  en: {
    aborted: 'Request cancelled',
    offline: (base: string) => `Could not reach the backend (${base})`,
    unexpectedHttp: (status: number) => `Unexpected HTTP ${status} response`,
    notJson: 'The server did not return JSON',
  },
  tr: {
    aborted: 'İstek iptal edildi',
    offline: (base: string) => `Backend'e ulaşılamadı (${base})`,
    unexpectedHttp: (status: number) => `Beklenmeyen HTTP ${status} yanıtı`,
    notJson: 'Sunucu JSON döndürmedi',
  },
});

const RAW_BASE: string = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

export interface ApiErrorDetail {
  field: string | null;
  message: string;
}

/** Normalised API failure. `code` is the backend error code, or a client code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = [], requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);

/** Test seam only (unit tests inject a MOCK fetch; never used by the app). */
export function __setFetchForTests(impl: FetchLike | null): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 20000);
  const outer = init?.signal;
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    if (outer?.aborted) throw new ApiError(0, 'ABORTED', pick(CLIENT_STR).aborted);
    throw new ApiError(0, 'BACKEND_OFFLINE', pick(CLIENT_STR).offline(API_BASE));
  } finally {
    clearTimeout(timeout);
    outer?.removeEventListener('abort', onAbort);
  }
  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    if (isErrorBody(body)) {
      const e = body.error;
      const details = (e.details ?? []).map((d) => ({ field: d.field ?? null, message: String(d.message) }));
      throw new ApiError(response.status, e.code, e.message, details, e.request_id);
    }
    throw new ApiError(response.status, `HTTP_${response.status}`, pick(CLIENT_STR).unexpectedHttp(response.status));
  }
  if (body === null) throw new ApiError(response.status, 'BAD_RESPONSE', pick(CLIENT_STR).notJson);
  return body as T;
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/health', { signal, timeoutMs: 8000 }),
  sites: (signal?: AbortSignal) => request<SitesResponse>('/sites', { signal }),
  validation: (signal?: AbortSignal) => request<ValidationResponse>('/validation', { signal }),
  createAnalysis: (input: AnalysisInput) =>
    request<QueuedResponse>('/analyses', { method: 'POST', body: JSON.stringify(input) }),
  analysis: (id: string, signal?: AbortSignal) =>
    request<JobRecord>(`/analyses/${encodeURIComponent(id)}`, { signal, timeoutMs: 30000 }),
  horizon: (id: string, signal?: AbortSignal) =>
    request<Horizon>(`/analyses/${encodeURIComponent(id)}/horizon`, { signal, timeoutMs: 30000 }),
  timeline: (id: string, signal?: AbortSignal) =>
    request<TimelineResponse>(`/analyses/${encodeURIComponent(id)}/timeline`, { signal, timeoutMs: 30000 }),
  compare: (analysisIds: string[], priority: Priority) =>
    request<CompareResponse>('/compare', {
      method: 'POST',
      body: JSON.stringify({ analysis_ids: analysisIds, priority }),
    }),
  shift: (analysisId: string, shiftsHours: number[]) =>
    request<QueuedResponse>('/scenarios/shift', {
      method: 'POST',
      body: JSON.stringify({ analysis_id: analysisId, shifts_hours: shiftsHours }),
    }),
};
