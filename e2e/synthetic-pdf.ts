/**
 * Un resumen de tarjeta en PDF, sintético y determinista, escrito a mano en
 * sintaxis PDF cruda (objetos + content stream + tabla `xref`).
 *
 * No se commitea NINGÚN resumen del usuario: son datos privados. Esto genera
 * uno equivalente en forma —renglones `DD-MM-YY DESCRIPCION … monto`, los
 * mismos que parsea el importador— con una capa de texto de verdad: Helvetica
 * base-14, sin fuente embebida, que es todo lo que `extractPdfText` necesita
 * (`getTextContent()` no dibuja nada, así que no hace falta ni canvas ni
 * `standardFontDataUrl`).
 *
 * Hermano de `MINIMAL_PDF` en tests/visual/mobile/mobile-coinify.browser.test.tsx,
 * con dos diferencias: varios renglones (para que `joinTextItems` tenga que
 * separar líneas de verdad) y una tabla `xref` correcta, para que pdfjs lea el
 * archivo por el camino normal y no por el de recuperación.
 *
 * TODO el archivo es ASCII a propósito: así `str.length === byteLength` y los
 * offsets del `xref` se calculan contando caracteres. `buildSyntheticStatementPdf`
 * lo verifica antes de devolver.
 */

/**
 * Los renglones tal como `extractPdfText` los tiene que devolver: un `Tj` por
 * renglón, cada uno 14 puntos más abajo que el anterior, así que
 * `joinTextItems` los agrupa por Y sin ambigüedad (su tolerancia es 2 puntos).
 * Sin paréntesis ni barras invertidas: no hay que escapar nada en el stream.
 */
export const SYNTHETIC_STATEMENT_LINES = [
  'DETALLE DEL CONSUMO',
  '22-06-25 * TIENDA DEMO UNO 06/06 100001 1.000,00',
  '02-11-25 * SUSCRIPCION DEMO 100003 3.000,00',
  '12-11-25 K COMERCIO DEMO 01/03 100004 4.000,00',
  'TOTAL A PAGAR 8.000,00',
];

/** `BT /F1 10 Tf 72 720 Td (…) Tj  0 -14 Td (…) Tj … ET` */
function buildContentStream(): string {
  const ops = ['BT', '/F1 10 Tf', '72 720 Td'];
  SYNTHETIC_STATEMENT_LINES.forEach((line, i) => {
    if (i > 0) ops.push('0 -14 Td');
    ops.push(`(${line}) Tj`);
  });
  ops.push('ET');
  return ops.join('\n');
}

/**
 * El PDF entero como string ASCII. Se pasa como string —y no como `Uint8Array`—
 * porque tiene que cruzar a `page.evaluate`, que serializa en JSON; del otro
 * lado un `new TextEncoder().encode(…)` lo vuelve byte por byte a lo mismo.
 */
export function buildSyntheticStatementPdf(): string {
  const content = buildContentStream();

  // Los cinco objetos del documento, en orden: 1 catálogo, 2 páginas, 3 la
  // página, 4 el content stream, 5 la fuente.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R'
      + ' /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  // Cada entrada del xref mide EXACTAMENTE 20 bytes: 10 de offset, espacio,
  // 5 de generación, espacio, la letra, espacio, salto de línea.
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${startxref}\n%%EOF\n`;

  // Si alguien mete un acento en un renglón, `/Length` y los offsets del xref
  // quedan cortos y pdfjs entra en modo recuperación sin decir nada. Mejor
  // romper acá.
  for (let i = 0; i < pdf.length; i++) {
    if (pdf.charCodeAt(i) > 0x7f) {
      throw new Error(
        `El PDF sintético tiene que ser ASCII puro (carácter no-ASCII en la posición ${i}): `
        + 'los offsets del xref se calculan contando caracteres.',
      );
    }
  }
  return pdf;
}
