import { describe, expect, it, vi } from 'vitest';
import { fail, ok } from '../../src/utils/response.js';

describe('response helpers', () => {
  it('ok() writes success payload', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Parameters<typeof ok>[0];

    ok(res, { hello: 'world' }, 201);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ success: true, data: { hello: 'world' } });
  });

  it('fail() writes error payload', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Parameters<typeof fail>[0];

    fail(res, 400, 'bad request', { code: 'BAD_REQUEST' });

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'bad request',
        code: 'BAD_REQUEST',
        details: undefined
      }
    });
  });
});
