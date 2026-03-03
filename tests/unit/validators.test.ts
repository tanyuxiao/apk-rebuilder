import { describe, expect, it } from 'vitest';
import { isValidPackageName, isValidVersionCode, toSafeFileStem } from '../../src/utils/validators.js';

describe('validators', () => {
  it('validates Android package name', () => {
    expect(isValidPackageName('com.example.app')).toBe(true);
    expect(isValidPackageName('1com.example')).toBe(false);
    expect(isValidPackageName('com..example')).toBe(false);
  });

  it('validates version code', () => {
    expect(isValidVersionCode('1')).toBe(true);
    expect(isValidVersionCode('100200')).toBe(true);
    expect(isValidVersionCode('-1')).toBe(false);
    expect(isValidVersionCode('1.0')).toBe(false);
  });

  it('creates safe apk file stem', () => {
    expect(toSafeFileStem('My App')).toBe('My App');
    expect(toSafeFileStem('app:/\\*?"<>|name')).toBe('app---------name');
    expect(toSafeFileStem('   ')).toBe('modded');
  });
});
