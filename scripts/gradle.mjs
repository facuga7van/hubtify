#!/usr/bin/env node
/**
 * `npm run mobile:apk` cross-platform. npm corre los scripts con cmd.exe en
 * Windows (no existe `./gradlew`) y con sh en CI/ubuntu (no existe
 * gradlew.bat). Uso: node scripts/gradle.mjs assembleDebug
 *
 * JAVA_HOME debe apuntar a un JDK 21 (ver «Entorno» del plan).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const androidDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('uso: node scripts/gradle.mjs <tarea gradle…>');
  process.exit(2);
}
if (!process.env.JAVA_HOME) {
  console.warn('[gradle] JAVA_HOME no está seteado: Gradle usará el java del PATH (se espera JDK 21).');
}

const result = spawnSync(isWin ? path.join(androidDir, 'gradlew.bat') : './gradlew', args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
});
process.exit(result.status ?? 1);
