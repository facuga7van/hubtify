#!/usr/bin/env node
/**
 * Nutrify AI estimation benchmark — the regression test for the Gemini prompt.
 *
 * Runs the SHIPPED prompt (imported from functions/src/gemini.ts, never copied)
 * against two fixed sets of dishes with reference calories and reports MAE,
 * median relative error, % within tolerance and % within the reference range.
 * Exits 1 when a set's MAE is above its threshold, so a prompt change that
 * regresses precision is caught before it is deployed.
 *
 * NOT part of `npm test`: every dish is one real Gemini call (network + money).
 * Run it by hand before touching the prompt or the model, and paste the
 * summary into the commit message.
 *
 * Usage:
 *   GEMINI_API_KEY=... npm run ai:bench
 *   npm run ai:bench -- --threshold 50 --real-threshold 130 --tolerance 0.2
 *   npm run ai:bench -- --set path/to/other-set.json --no-real
 *   npm run ai:bench -- --out results.jsonl        # raw rows, one JSON per line
 *
 * Key resolution, in order: GEMINI_API_KEY in the environment, then a
 * `GEMINI_API_KEY=...` line in functions/.env or functions/.secret.local
 * (the files the Firebase emulator reads; both are git-ignored). The key is
 * never printed.
 *
 * Sets (tests/functions/fixtures/):
 *   ai-benchmark-set.json   15 "clean" Argentine dishes from the 2026-09-02
 *                           research (docs/superpowers/plans/2026-09-02-ai-
 *                           estimation-research.md §4.4 has every source).
 *                           Default threshold: MAE <= 50 kcal.
 *   ai-benchmark-real.json  18 descriptions the user actually typed, with his
 *                           own corrections as reference where they exist
 *                           (2026-09-02-ai-real-benchmark.md). Noisier
 *                           references, so its own threshold: MAE <= 130.
 *
 * Every row has: id, description, reference_kcal, lo, hi, reference_source, note.
 *
 * Needs Node >= 22.6 for `--experimental-strip-types` (Node 23+ has it on by
 * default); the npm script passes the flag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GEMINI_MODEL,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  GeminiOutputError,
  buildRequestBody,
  parseEstimate,
} from '../functions/src/gemini.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'functions', 'fixtures');

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

const THRESHOLD = Number(flag('threshold', 50));
const REAL_THRESHOLD = Number(flag('real-threshold', 130));
const TOLERANCE = Number(flag('tolerance', 0.2));
const MIN_INTERVAL_MS = Number(flag('interval', 1200));
const OUT = flag('out', null);
const SETS = [
  { name: 'clean', file: flag('set', path.join(FIXTURES, 'ai-benchmark-set.json')), threshold: THRESHOLD },
];
if (!has('no-real')) {
  SETS.push({ name: 'real', file: flag('real-set', path.join(FIXTURES, 'ai-benchmark-real.json')), threshold: REAL_THRESHOLD });
}

// ── Key ─────────────────────────────────────────────────────────────────────

function readKey() {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim();
  for (const file of ['.env', '.secret.local']) {
    const p = path.join(ROOT, 'functions', file);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  }
  console.error('No Gemini key: set GEMINI_API_KEY or put it in functions/.env');
  process.exit(2);
}

const KEY = readKey();
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${KEY}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── One call, exactly as the Cloud Function makes it ────────────────────────

async function estimate(description) {
  const body = JSON.stringify(buildRequestBody(description, SYSTEM_PROMPT));
  for (let attempt = 1; attempt <= 4; attempt++) {
    const t0 = Date.now();
    const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const ms = Date.now() - t0;
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      console.error(`  429 (attempt ${attempt}); waiting ${25 * attempt} s`);
      if (attempt === 4) return { error: 'http-429', ms };
      await sleep(25000 * attempt);
      continue;
    }
    if (!res.ok) return { error: `http-${res.status}`, ms, detail: String(json.error?.message ?? '').slice(0, 200) };
    try {
      const est = parseEstimate(json);
      return { kcal: est.calories, items: est.items, ms, finish: json.candidates?.[0]?.finishReason ?? null };
    } catch (err) {
      if (err instanceof GeminiOutputError) return { error: err.reason, ms, detail: (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').slice(0, 120) };
      throw err;
    }
  }
  return { error: 'unreachable', ms: 0 };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

const median = (xs) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (n, d) => (d === 0 ? 0 : Math.round((100 * n) / d));

function summarize(rows) {
  const ok = rows.filter((r) => r.kcal != null);
  const errs = ok.map((r) => Math.abs(r.kcal - r.ref));
  const apes = ok.map((r) => Math.abs(r.kcal - r.ref) / r.ref);
  return {
    n: rows.length,
    ok: ok.length,
    mae: ok.length ? Math.round(errs.reduce((a, b) => a + b, 0) / ok.length) : NaN,
    medianApePct: Math.round(100 * median(apes)),
    withinTolPct: pct(apes.filter((a) => a <= TOLERANCE).length, rows.length),
    inRangePct: pct(ok.filter((r) => r.kcal >= r.lo && r.kcal <= r.hi).length, rows.length),
    bias: ok.length ? Math.round(ok.reduce((a, r) => a + (r.kcal - r.ref), 0) / ok.length) : NaN,
    medianMs: Math.round(median(rows.map((r) => r.ms))),
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(`model ${GEMINI_MODEL} · prompt ${PROMPT_VERSION} · tolerance ±${Math.round(TOLERANCE * 100)} %`);
const out = OUT ? fs.createWriteStream(OUT, { flags: 'a' }) : null;
let failed = false;

for (const set of SETS) {
  const dishes = JSON.parse(fs.readFileSync(set.file, 'utf8'));
  console.log(`\n[${set.name}] ${dishes.length} dishes from ${path.relative(ROOT, set.file)}`);
  const rows = [];
  for (const d of dishes) {
    const t0 = Date.now();
    const r = await estimate(d.description);
    const row = { set: set.name, id: d.id, description: d.description, ref: d.reference_kcal, lo: d.lo, hi: d.hi,
      kcal: r.kcal ?? null, error: r.error ?? null, ms: r.ms, items: r.items ?? null, prompt: PROMPT_VERSION, model: GEMINI_MODEL, at: new Date().toISOString() };
    rows.push(row);
    out?.write(JSON.stringify(row) + '\n');
    const mark = r.kcal == null ? `ERR:${r.error}` : (r.kcal >= d.lo && r.kcal <= d.hi ? '  ' : '✗ ');
    const verdict = r.kcal == null ? '' : `${String(r.kcal).padStart(5)} kcal (ref ${d.reference_kcal}, ${d.lo}–${d.hi})`;
    console.log(`  ${mark}${String(d.id).padStart(2)} ${d.description.slice(0, 48).padEnd(49)} ${verdict.padEnd(34)} ${r.ms} ms${r.detail ? `  ${r.detail}` : ''}`);
    const wait = MIN_INTERVAL_MS - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  const s = summarize(rows);
  const verdict = s.mae <= set.threshold ? 'OK' : `FAIL (MAE ${s.mae} > ${set.threshold})`;
  if (s.mae > set.threshold || Number.isNaN(s.mae)) failed = true;
  console.log(`  → ok ${s.ok}/${s.n} · MAE ${s.mae} kcal · APE mediana ${s.medianApePct} % · ±${Math.round(TOLERANCE * 100)} % ${s.withinTolPct} % · en rango ${s.inRangePct} % · sesgo ${s.bias >= 0 ? '+' : ''}${s.bias} · lat. mediana ${s.medianMs} ms · ${verdict}`);
}

out?.end();
process.exit(failed ? 1 : 0);
