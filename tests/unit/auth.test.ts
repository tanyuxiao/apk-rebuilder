import { describe, expect, it, vi } from 'vitest';

type Req = { header: (name: string) => string | undefined };

describe('auth middleware', () => {
  it('allows request when API_KEY is empty', async () => {
    vi.resetModules();
    vi.stubEnv('API_KEY', '');
    vi.stubEnv('AUTH_TOKEN', '');

    const { requireAuth } = await import('../../src/middleware/auth.js');

    const req: Req = { header: () => undefined };
    const status = vi.fn().mockReturnValue({ json: vi.fn() });
    const res = { status } as unknown as Parameters<typeof requireAuth>[1];
    const next = vi.fn();

    requireAuth(req as Parameters<typeof requireAuth>[0], res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects request with invalid token when auth is enabled', async () => {
    vi.resetModules();
    vi.stubEnv('API_KEY', 'secret');
    vi.stubEnv('AUTH_TOKEN', '');

    const { requireAuth } = await import('../../src/middleware/auth.js');

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const req: Req = { header: () => 'Bearer wrong' };
    const res = { status } as unknown as Parameters<typeof requireAuth>[1];
    const next = vi.fn();

    requireAuth(req as Parameters<typeof requireAuth>[0], res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('allows request with valid bearer token', async () => {
    vi.resetModules();
    vi.stubEnv('API_KEY', 'secret');
    vi.stubEnv('AUTH_TOKEN', '');

    const { requireAuth } = await import('../../src/middleware/auth.js');

    const req: Req = { header: () => 'Bearer secret' };
    const status = vi.fn().mockReturnValue({ json: vi.fn() });
    const res = { status } as unknown as Parameters<typeof requireAuth>[1];
    const next = vi.fn();

    requireAuth(req as Parameters<typeof requireAuth>[0], res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows request with x-api-key header', async () => {
    vi.resetModules();
    vi.stubEnv('API_KEY', 'secret');
    vi.stubEnv('AUTH_TOKEN', '');

    const { requireAuth } = await import('../../src/middleware/auth.js');

    const req: Req = {
      header: (name: string) => (name.toLowerCase() === 'x-api-key' ? 'secret' : undefined)
    };
    const status = vi.fn().mockReturnValue({ json: vi.fn() });
    const res = { status } as unknown as Parameters<typeof requireAuth>[1];
    const next = vi.fn();

    requireAuth(req as Parameters<typeof requireAuth>[0], res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows request with api_key query', async () => {
    vi.resetModules();
    vi.stubEnv('API_KEY', 'secret');
    vi.stubEnv('AUTH_TOKEN', '');

    const { requireAuth } = await import('../../src/middleware/auth.js');

    const req = {
      header: () => undefined,
      query: { api_key: 'secret' }
    } as unknown as Parameters<typeof requireAuth>[0];
    const status = vi.fn().mockReturnValue({ json: vi.fn() });
    const res = { status } as unknown as Parameters<typeof requireAuth>[1];
    const next = vi.fn();

    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
