/**
 * MOCK NOTICE: fetch is replaced by a stub returning hand-written HTTP responses
 * shaped like backend error bodies. No scientific values are involved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { __setFetchForTests, api, ApiError } from '../client';
import { explainError } from '../errors';

function stub(status: number, body: unknown) {
  __setFetchForTests(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => __setFetchForTests(null));

describe('api client error normalisation', () => {
  it.each([
    [503, 'DEM_MISSING'],
    [503, 'SPICE_MISSING'],
    [429, 'QUEUE_FULL'],
    [429, 'RATE_LIMITED'],
    [409, 'HORIZON_NOT_READY'],
    [404, 'ANALYSIS_NOT_FOUND'],
    [422, 'INCOMPARABLE'],
  ])('HTTP %i %s keeps code and status', async (status, code) => {
    stub(status, { error: { code, message: 'x', request_id: 'r1' } });
    const error = await api.health().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    expect((error as ApiError).status).toBe(status);
    expect(explainError(error).code).toBe(code);
    expect(explainError(error).title).not.toMatch(/Bilinmeyen/);
  });

  it('exposes 422 field details', async () => {
    stub(422, { error: { code: 'INVALID_INPUT', message: 'bad', details: [{ field: 'latitude', message: 'Input should be less than or equal to -80' }] } });
    const error = (await api.createAnalysis({} as never).catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual([{ field: 'latitude', message: 'Input should be less than or equal to -80' }]);
  });

  it('maps network failure to BACKEND_OFFLINE', async () => {
    __setFetchForTests(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await api.health().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('BACKEND_OFFLINE');
    expect(error.status).toBe(0);
  });

  it('treats non-JSON error pages as HTTP_<status>, not success', async () => {
    __setFetchForTests(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const error = (await api.health().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('HTTP_502');
  });

  it('unknown codes are surfaced verbatim, never hidden', () => {
    const explained = explainError(new ApiError(500, 'SOMETHING_NEW', 'msg'));
    expect(explained.code).toBe('SOMETHING_NEW');
    expect(explained.engineerText).toContain('SOMETHING_NEW');
  });
});
