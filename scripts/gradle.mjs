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

// Con `shell: true` (Windows) la ruta viaja por cmd.exe: sin comillas, un repo
// clonado en `C:\Mis Proyectos\hubtify` se parte en el espacio.
const gradlew = isWin ? `"${path.join(androidDir, 'gradlew.bat')}"` : './gradlew';

const result = spawnSync(gradlew, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
});

// `status` es null si el proceso ni siquiera arrancó (ENOENT, EACCES): sin
// esto el script saldría 1 sin decir por qué.
if (result.error) console.error('[gradle]', result.error.message);
process.exit(result.status ?? 1);
