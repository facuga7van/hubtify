/**
 * Extracción de texto de un PDF **en el renderer**, escritorio y Android.
 *
 * Nació para Android, donde no hay Node. Escritorio lo leía en el main con
 * `pdf-parse` (node-only, con un canvas nativo de 35 MB de polyfills): ese
 * módulo nunca llegó al paquete instalado y el import falló en toda versión
 * publicada desde marzo. `pdfjs-dist` corre en cualquier navegador y
 * `getTextContent()` no necesita canvas, así que ahora hay UN camino: el main
 * (o el host de Android) entrega los bytes y esto los convierte en texto.
 *
 * Lo único que puede fallar es la resolución del worker (Vite ≥ 7.1, CSP
 * `worker-src`, `file://` en Electron). Quien llama lo envuelve en `try/catch`
 * y le explica al usuario qué hacer; el peor caso es un aviso, no un cuelgue.
 *
 * El import es dinámico a propósito: pdfjs pesa, y la mayoría de las sesiones
 * de Coinify no importan un resumen. Solo se descarga cuando se elige un PDF.
 */

/** Texto plano, línea por línea, en el orden en que el PDF las pinta. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');

  // `?url` deja que Vite emita el worker como asset y devuelva su ruta final,
  // que con `base: './'` es relativa al index — lo que Capacitor sirve.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({
    data: bytes,
    // Sin estos, pdfjs sale a buscar los mapas de caracteres y las fuentes
    // estándar por red: dentro del WebView no hay origen del que traerlos y el
    // documento queda esperando. El texto no los necesita.
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(joinTextItems(content.items as Array<Record<string, unknown>>));
  }
  await doc.destroy();
  // Mismo separador de páginas que imprimía `pdf-parse`, para que
  // el parser de líneas vea exactamente la misma forma en las dos plataformas.
  return pages.join('\n\n');
}

/**
 * Reconstruye los renglones a partir de los fragmentos que devuelve pdfjs.
 *
 * `getTextContent()` no da líneas: da trozos con su matriz de transformación.
 * El parser del resumen es **line-based** (`/^DD-MM-YY /`), así que juntar mal
 * los renglones lo rompe entero. Se agrupa por coordenada Y —el elemento 5 de
 * `transform`— con una tolerancia de 2 puntos, que es lo que se mueve la línea
 * base dentro de un mismo renglón.
 */
export function joinTextItems(items: Array<Record<string, unknown>>): string {
  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];

  for (const item of items) {
    const text = typeof item.str === 'string' ? item.str : '';
    const transform = item.transform as number[] | undefined;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    if (text === '') {
      // `hasEOL` es la única señal fiable de fin de renglón en un PDF sin texto.
      if (item.hasEOL === true && lines.length > 0) lines[lines.length - 1].y = Number.NaN;
      continue;
    }
    const x = transform[4];
    const y = transform[5];
    const last = lines[lines.length - 1];
    if (last && Number.isFinite(last.y) && Math.abs(last.y - y) <= 2) {
      last.parts.push({ x, text });
    } else {
      lines.push({ y, parts: [{ x, text }] });
    }
  }

  return lines
    .map((line) => line.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.text)
      .join(' ')
      // pdfjs devuelve los fragmentos ya espaciados; unirlos con espacio deja
      // dobles. El parser tolera espacios múltiples, pero el texto que se le
      // muestra al usuario en «líneas salteadas» no.
      .replace(/\s{2,}/g, ' ')
      .trim())
    .filter((line) => line !== '')
    .join('\n');
}
