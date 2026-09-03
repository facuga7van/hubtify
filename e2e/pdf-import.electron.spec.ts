import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSyntheticStatementPdf, SYNTHETIC_STATEMENT_LINES } from './synthetic-pdf';

// La extracción de texto del PDF de Coinify en la app EMPAQUETADA, bajo `file://`.
//
// Por qué existe este test: hasta ahora el texto se sacaba en el main con
// `pdf-parse`, que es node-only y nunca entró al paquete instalado — el import
// falló en TODA versión publicada desde marzo y nadie se enteró, porque
// `npm start` tiene node_modules entero. La extracción se movió al renderer con
// pdfjs (`src/shared/pdf-text.ts`), pero eso deja abierto un riesgo de la MISMA
// clase: lo único que ejecuta pdfjs de verdad es
// tests/visual/mobile/mobile-coinify.browser.test.tsx, y corre sobre
// http://localhost, donde el worker resuelve. La app instalada NO es eso: se
// carga con `mainWindow.loadFile(...)` (electron/main.ts:272) → origen `file://`.
//
// ── HALLAZGO MEDIDO: worker REAL, sin fake worker ────────────────────────────
// Corrido contra el paquete real (Electron 41, pdfjs 5.4.296). La anotación
// `pdfjs-worker` del reporte dio, textual:
//
//     WORKER REAL, vía la URL file:// directa.
//       location: file:///…/app.asar/.vite/renderer/main_window/index.html#/login
//       intentos de Worker:
//         - file:///…/assets/pdf.worker.min-<hash>.mjs [type=module] construido=true
//       console.warn de pdfjs: (ninguno)
//       exports del chunk: extractPdfText, joinTextItems
//
// Un solo `new Worker`, construido bien, sin evento `error`, sin el
// "Warning: Setting up fake worker." de pdf.mjs:14993. El texto sale completo.
//
// ── OJO CON ESTO, que ya hizo perder tiempo una vez ──────────────────────────
// En Electron el origen de una página `file://` **NO es opaco**: `location.origin`
// vale la cadena `"file://"`, no `"null"` como en un Chrome pelado. Electron
// registra `file:` como scheme estándar. Eso decide TODO el camino que toma pdfjs
// en `PDFWorker#initialize` (node_modules/pdfjs-dist/build/pdf.mjs:14924-14936):
//
//     if (!PDFWorker._isSameOrigin(window.location, workerSrc)) {
//       workerSrc = PDFWorker._createCDNWrapper(new URL(workerSrc, window.location).href);
//     }
//     const worker = new Worker(workerSrc, { type: "module" });
//
// y `_isSameOrigin` (pdf.mjs:14861-14868):
//
//     const base = URL.parse(baseUrl);
//     if (!base?.origin || base.origin === "null") { return false; }
//     const other = new URL(otherUrl, base);
//     return base.origin === other.origin;
//
// Con `origin === "file://"` el guard NO corta: compara `file://` contra el
// origen del `workerSrc` (también `file://`, es un asset hermano) y devuelve
// **true**. O sea: pdfjs considera el worker mismo-origen y lo levanta directo,
// sin pasar por `_createCDNWrapper` y sin blob intermedio. Si el origen fuera
// `"null"` —como se suponía antes de medir— iría por el blob wrapper, que es un
// camino distinto y con otro riesgo. No lo es. No repitas la suposición.
//
// Y el fallback también anda, verificado: forzando `window.Worker` a tirar
// siempre (prueba negativa, un spec descartable) pdfjs emite
// "Warning: Setting up fake worker." (pdf.mjs:14993), cae a `#setupFakeWorker()`
// (pdf.mjs:14992-15010) —que hace `await import(workerSrc)` en el hilo
// principal— y devuelve EXACTAMENTE el mismo texto. Bajo `file://` en Electron
// funcionan los dos caminos: importar un módulo file:// desde una página file://
// es algo que esta app ya hace para arrancar (el bundle del renderer es ESM:
// index.html carga `<script type="module" crossorigin src="./assets/index-*.js">`).
// O sea que el riesgo que motivó este test no se materializa — pero queda medido
// en cada corrida en vez de supuesto.
//
// El test NO exige que el camino sea el del worker real —si mañana cae al fake
// worker y el texto igual sale, es aceptable—; lo que exige es que SALGA TEXTO.
// Cuál de los dos caminos tomó lo sigue midiendo e informando en la anotación
// `pdfjs-worker`, para que un cambio de camino se vea en el reporte.

function findPackagedApp(): string | null {
  const outDir = join(process.cwd(), 'out');
  if (!existsSync(outDir)) return null;
  for (const entry of readdirSync(outDir)) {
    const dir = join(outDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const asar = join(dir, 'resources', 'app.asar');
    if (existsSync(asar)) return asar;
  }
  return null;
}

const appPath = findPackagedApp();

/** Lo que devuelve el sondeo del asar: qué assets del renderer se empaquetaron. */
interface RendererAssets {
  windowName: string | null;
  assetCount: number;
  /** El chunk que exporta `extractPdfText`, o null si no se empaquetó. */
  pdfTextChunk: string | null;
  /** `pdf.worker.min-<hash>.mjs`, o null si Vite no emitió el asset. */
  workerAsset: string | null;
  jsAssets: string[];
  error: string | null;
}

/** Lo que devuelve la corrida de `extractPdfText` dentro del renderer. */
interface WorkerAttempt {
  url: string;
  type: string;
  constructed: boolean;
  constructError: string | null;
  runtimeError: string | null;
}
interface ExtractOutcome {
  ok: boolean;
  text: string;
  error: string | null;
  attempts: WorkerAttempt[];
  warnings: string[];
  exportNames: string[];
  href: string;
  origin: string;
}

test.describe('Coinify — extracción de PDF en el renderer empaquetado (file://)', () => {
  test.skip(!appPath, 'Corré `npm run package` primero para tener la app empaquetada.');

  let app: ElectronApplication;

  test.beforeAll(async () => {
    // userData nuevo: nunca se toca el perfil ni los datos reales del usuario.
    const userDataDir = mkdtempSync(join(tmpdir(), 'hubtify-pdf-e2e-'));
    app = await electron.launch({
      args: [appPath!, `--user-data-dir=${userDataDir}`],
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  /**
   * Sondea el asar desde el main —`fs` de Electron sabe leer adentro del asar—
   * y ubica los dos assets de los que depende el importador. Se hace acá y no
   * desde Playwright porque el paquete es un asar, no un directorio.
   */
  async function readRendererAssets(): Promise<RendererAssets> {
    return app.evaluate(async (_electron, args) => {
      // `evaluate` corre en un scope de eval sin `require` léxico; se llega al
      // require del bundle por el módulo principal (mismo truco que
      // nutrition.electron.spec.ts).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = (typeof require === 'function' ? require : (globalThis as any).process.mainModule.require);
      const fs = req('node:fs');
      const path = req('node:path');
      const empty = {
        windowName: null as string | null, assetCount: 0,
        pdfTextChunk: null as string | null, workerAsset: null as string | null,
        jsAssets: [] as string[], error: null as string | null,
      };
      const statSize = (p: string): number => {
        try { return fs.statSync(p).size as number; } catch { return Number.MAX_SAFE_INTEGER; }
      };
      try {
        const rendererRoot = path.join(args.appPath, '.vite', 'renderer');
        const windowName = (fs.readdirSync(rendererRoot) as string[])[0] ?? null;
        if (!windowName) return { ...empty, error: `no hay ninguna ventana en ${rendererRoot}` };
        const dir = path.join(rendererRoot, windowName, 'assets');
        const files = fs.readdirSync(dir) as string[];
        const js = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
        // Rollup nombra el chunk de un import dinámico con el basename del
        // módulo: `pdf-text-<hash>.js`. Si algún día cambia el chunking, se lo
        // busca por contenido: es el chunk chico que menciona `hasEOL`
        // (el de pdfjs también lo menciona, pero pesa cientos de kB).
        const pdfTextChunk = files.find((f) => /^pdf-text-[\w-]+\.js$/.test(f))
          ?? js.find((f) => statSize(path.join(dir, f)) < 20_000
            && (fs.readFileSync(path.join(dir, f), 'utf8') as string).includes('hasEOL'))
          ?? null;
        const workerAsset = files.find((f) => /^pdf\.worker[\w.-]*\.mjs$/.test(f)) ?? null;
        return { windowName, assetCount: files.length, pdfTextChunk, workerAsset, jsAssets: js, error: null };
      } catch (e) {
        return { ...empty, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      }
    }, { appPath: appPath! });
  }

  test('el chunk de pdf-text y el worker de pdfjs ESTÁN dentro del paquete', async () => {
    // La regresión de marzo en su forma más barata: el módulo que hace el
    // trabajo nunca llegó al .asar. Si esto falla, ninguna versión instalada
    // puede importar un resumen, por más que `npm start` ande.
    const assets = await readRendererAssets();
    expect(assets.error, 'no se pudo leer el directorio de assets del renderer dentro del asar').toBeNull();
    expect(assets.assetCount).toBeGreaterThan(0);
    expect(
      assets.pdfTextChunk,
      `src/shared/pdf-text.ts no está en el paquete. Assets JS empaquetados:\n  ${assets.jsAssets.join('\n  ')}`,
    ).not.toBeNull();
    expect(
      assets.workerAsset,
      'Vite no emitió `pdf.worker.min-*.mjs` como asset. `import(\'pdfjs-dist/build/pdf.worker.min.mjs?url\')`'
      + ` no llegó al paquete → GlobalWorkerOptions.workerSrc apunta a la nada. Assets JS:\n  ${assets.jsAssets.join('\n  ')}`,
    ).not.toBeNull();
  });

  test('extractPdfText lee la capa de texto de un resumen sintético', async () => {
    // 30 s de arranque + hasta 40 s de pdfjs; el default de 60 s no alcanza.
    test.setTimeout(120_000);

    // Los otros specs llaman `window` a la Page; acá no se puede, porque el
    // cuerpo de `evaluate` corre en el renderer y ahí `window` es el window de
    // verdad (se parchea `window.Worker`).
    const page = await app.firstWindow();
    await page.waitForSelector('.auth-card', { timeout: 30_000 });

    const assets = await readRendererAssets();
    expect(assets.pdfTextChunk, 'sin el chunk de pdf-text no hay nada que ejecutar').not.toBeNull();

    const outcome: ExtractOutcome = await page.evaluate(async (args) => {
      const attempts: WorkerAttempt[] = [];
      const warnings: string[] = [];
      let exportNames: string[] = [];

      // pdfjs avisa "Warning: Setting up fake worker." por console.warn
      // (pdf.mjs:14993). Es la única señal pública de que cayó al fallback.
      const originalWarn = console.warn;
      console.warn = (...parts: unknown[]) => {
        warnings.push(parts.map((p) => String(p)).join(' '));
        originalWarn.apply(console, parts);
      };

      // Y esto registra CADA intento de levantar un worker: la URL (blob: si
      // pdfjs pasó por el CDN wrapper, file: si lo tomó como mismo origen) y si
      // el constructor tiró o si el worker murió después.
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          const record: WorkerAttempt = {
            url: String(scriptURL),
            type: options?.type ?? 'classic',
            constructed: false,
            constructError: null,
            runtimeError: null,
          };
          attempts.push(record);
          try {
            super(scriptURL, options);
          } catch (e) {
            record.constructError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
            throw e;
          }
          record.constructed = true;
          this.addEventListener('error', (ev: ErrorEvent) => {
            record.runtimeError = ev.message || 'evento error sin mensaje';
          });
        }
      };

      try {
        // Mismo módulo que carga Import.tsx (`await import('../../../shared/pdf-text')`),
        // pero por su URL final dentro del paquete. Absoluta a propósito: un
        // especificador relativo no resuelve desde el scope de `evaluate`.
        const url = new URL(`./assets/${args.chunk}`, location.href).href;
        const mod = await import(url) as Record<string, unknown>;
        exportNames = Object.keys(mod);

        // Medido: el chunk exporta `extractPdfText, joinTextItems` con sus
        // nombres reales, así que el camino normal alcanza. El fallback está
        // porque Rollup SÍ minifica los exports de otros chunks internos (en
        // Import-*.js queda `export{We as I,Ye as a,Ge as r}`) y un cambio de
        // chunking podría alcanzar a este: `extractPdfText` es la única export
        // ASYNC —`joinTextItems` es síncrona—, así que se la identifica por ahí.
        const named = mod.extractPdfText;
        const extract = (typeof named === 'function'
          ? named
          : Object.values(mod).find(
            (v) => typeof v === 'function' && (v as () => unknown).constructor.name === 'AsyncFunction',
          )) as ((bytes: Uint8Array) => Promise<string>) | undefined;

        if (typeof extract !== 'function') {
          return {
            ok: false, text: '', attempts, warnings, exportNames,
            href: location.href, origin: location.origin,
            error: `el chunk ${args.chunk} no exporta ninguna función async (exports: ${exportNames.join(', ') || '—'})`,
          };
        }

        const bytes = new TextEncoder().encode(args.pdf);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const text = await Promise.race([
          extract(bytes),
          new Promise<string>((_resolve, reject) => {
            // El peor caso NO es una excepción: es que pdfjs se quede esperando
            // para siempre un worker que nunca contesta ni emite `error`.
            timer = setTimeout(
              () => reject(new Error(`extractPdfText no resolvió en ${args.timeoutMs} ms: pdfjs quedó colgado esperando al worker`)),
              args.timeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        return {
          ok: true, text, error: null, attempts, warnings, exportNames,
          href: location.href, origin: location.origin,
        };
      } catch (e) {
        return {
          ok: false, text: '', attempts, warnings, exportNames,
          href: location.href, origin: location.origin,
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        };
      } finally {
        window.Worker = NativeWorker;
        console.warn = originalWarn;
      }
    }, { chunk: assets.pdfTextChunk!, pdf: buildSyntheticStatementPdf(), timeoutMs: 40_000 });

    // Lo único que hace que este test valga la pena: que el renderer se haya
    // cargado desde el disco y NO por http. Si esto deja de ser cierto, dejó de
    // probar la app instalada y pasó a duplicar el test de navegador, que corre
    // sobre http://localhost.
    expect(outcome.href, 'el renderer empaquetado tendría que cargarse con loadFile → file://').toMatch(/^file:\/\//);
    expect(outcome.origin, 'el renderer no puede estar servido por http: ahí el worker resuelve solo').toBe('file://');

    const diagnostics = [
      `  location: ${outcome.href}`,
      `  intentos de Worker: ${outcome.attempts.length === 0 ? '(ninguno)' : ''}`,
      ...outcome.attempts.map((a) =>
        `    - ${a.url.slice(0, 120)} [type=${a.type}] construido=${a.constructed}`
        + `${a.constructError ? ` constructError=${a.constructError}` : ''}`
        + `${a.runtimeError ? ` runtimeError=${a.runtimeError}` : ''}`),
      `  console.warn de pdfjs: ${outcome.warnings.length === 0 ? '(ninguno)' : ''}`,
      ...outcome.warnings.map((w) => `    - ${w}`),
      `  exports del chunk: ${outcome.exportNames.join(', ') || '—'}`,
    ].join('\n');

    expect(
      outcome.error,
      'extractPdfText NO pudo leer un PDF con capa de texto en el renderer empaquetado.\n'
      + 'Ni el worker de pdfjs resolvió ni funcionó el fake worker: el import de resúmenes\n'
      + 'está roto en la app instalada (aunque `npm start` ande).\n'
      + diagnostics,
    ).toBeNull();

    // El texto: los renglones tienen que salir tal cual, uno por línea.
    for (const line of SYNTHETIC_STATEMENT_LINES) {
      expect(outcome.text, `falta el renglón «${line}» en el texto extraído.\n${diagnostics}`).toContain(line);
    }
    expect(outcome.text.split('\n').filter((l) => l.trim() !== '').length)
      .toBeGreaterThanOrEqual(SYNTHETIC_STATEMENT_LINES.length);

    // El hallazgo, al reporte: ¿worker real o fake worker bajo file://?
    const fellBackToFakeWorker = outcome.warnings.some((w) => /fake worker/i.test(w));
    const liveWorkers = outcome.attempts.filter((a) => a.constructed && !a.runtimeError);
    const verdict = fellBackToFakeWorker
      ? `FAKE WORKER (hilo principal). Intentos de Worker: ${outcome.attempts.length}.`
      : liveWorkers.length > 0
        ? `WORKER REAL, vía ${liveWorkers[0].url.startsWith('blob:') ? 'blob: (CDN wrapper de pdfjs)' : 'la URL file:// directa'}.`
        : 'WORKER REAL sin intentos registrados (¿pdfjs cambió de camino?).';
    test.info().annotations.push({ type: 'pdfjs-worker', description: `${verdict}\n${diagnostics}` });
    console.log(`[pdf-import e2e] pdfjs bajo file:// → ${verdict}\n${diagnostics}`);
  });
});
