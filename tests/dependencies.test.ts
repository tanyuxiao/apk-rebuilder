import { describe, expect, it } from 'vitest';
import { apktoolPath, apksignerPath, javaPath, keytoolPath, zipalignPath } from '../src/config/env.js';
import { swaggerSpec } from '../src/config/swagger.js';

describe('dependency config', () => {
  it('exposes required toolchain command paths', () => {
    expect(apktoolPath.length).toBeGreaterThan(0);
    expect(zipalignPath.length).toBeGreaterThan(0);
    expect(apksignerPath.length).toBeGreaterThan(0);
    expect(keytoolPath.length).toBeGreaterThan(0);
    expect(javaPath.length).toBeGreaterThan(0);
  });

  it('builds swagger spec with paths', () => {
    const paths = swaggerSpec.paths || {};
    expect(Object.keys(paths).length).toBeGreaterThan(0);
    expect(paths['/health']).toBeTruthy();
    expect(paths['/api/upload']).toBeTruthy();
  });
});
