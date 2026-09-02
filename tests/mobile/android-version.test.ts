import { describe, it, expect } from 'vitest';
import { versionCodeFrom, patchBuildGradle } from '../../scripts/android-version.mjs';

const TEMPLATE = `    defaultConfig {
        applicationId "com.hubtify.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }`;

describe('android-version', () => {
  it('versionCode = major*10000 + minor*100 + patch', () => {
    expect(versionCodeFrom('0.8.2')).toBe(802);
    expect(versionCodeFrom('1.2.3')).toBe(10203);
    expect(versionCodeFrom('2.0.0-beta.1')).toBe(20000);
  });

  it('rechaza versiones que no son semver o que desbordan', () => {
    expect(() => versionCodeFrom('abc')).toThrow(/inválida/);
    expect(() => versionCodeFrom('1.100.0')).toThrow(/versionCode/);
  });

  it('reescribe versionCode y versionName en el template de Capacitor', () => {
    const out = patchBuildGradle(TEMPLATE, '0.8.2');
    expect(out).toContain('versionCode 802');
    expect(out).toContain('versionName "0.8.2"');
    expect(out).toContain('applicationId "com.hubtify.app"');
  });

  it('es idempotente', () => {
    const once = patchBuildGradle(TEMPLATE, '0.8.2');
    expect(patchBuildGradle(once, '0.8.2')).toBe(once);
  });

  it('lanza si el gradle no tiene los campos', () => {
    expect(() => patchBuildGradle('android {}', '0.8.2')).toThrow(/versionCode/);
  });
});
