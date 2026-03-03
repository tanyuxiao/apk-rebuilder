import { describe, expect, it } from 'vitest';
import { parseUnityPatchesInput } from '../../src/services/unity-config-service.js';

describe('unity config parser', () => {
  it('parses array payload', () => {
    const items = parseUnityPatchesInput([{ path: 'a.b', value: 1 }]);
    expect(items).toEqual([{ path: 'a.b', value: 1 }]);
  });

  it('parses json string payload', () => {
    const items = parseUnityPatchesInput('[{"path":"x.y","value":"ok"}]');
    expect(items).toEqual([{ path: 'x.y', value: 'ok' }]);
  });

  it('throws on invalid payload', () => {
    expect(() => parseUnityPatchesInput('{"path":"x"}')).toThrow('unityPatches must be an array');
  });
});
