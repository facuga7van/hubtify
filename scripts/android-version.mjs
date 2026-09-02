#!/usr/bin/env node
/**
 * Escribe `versionName` y `versionCode` en android/app/build.gradle a partir
 * de package.json (spec §5: versionCode = major*10000 + minor*100 + patch).
 * Lo corre `npm run mobile:sync` antes de `cap sync`. Sin dependencias.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function versionCodeFrom(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`versión inválida en package.json: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`minor/patch > 99 rompen el orden de versionCode: ${version}`);
  }
  return major * 10000 + minor * 100 + patch;
}

export function patchBuildGradle(source, version) {
  const code = versionCodeFrom(version);
  let hits = 0;
  const out = source
    .replace(/versionCode\s+\d+/, () => {
      hits++;
      return `versionCode ${code}`;
    })
    .replace(/versionName\s+"[^"]*"/, () => {
      hits++;
      return `versionName "${version}"`;
    });
  if (hits !== 2) throw new Error('no encontré versionCode/versionName en android/app/build.gradle');
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
  const before = readFileSync(gradlePath, 'utf8');
  const after = patchBuildGradle(before, version);
  if (after !== before) writeFileSync(gradlePath, after);
  console.log(`[android-version] versionName ${version} versionCode ${versionCodeFrom(version)}`);
}
