import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { OllamaStatus } from '../../../shared/types';

const MODEL = 'facundotgalvan/nutrify';
const DEFAULT_PORT = 11434;
let port = DEFAULT_PORT;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min after last use

export function getOllamaPort(): number { return port; }

let ollamaProcess: ChildProcess | null = null;
let inactivityTimer: NodeJS.Timeout | null = null;
let status: OllamaStatus = 'stopped';
let startupPromise: Promise<void> | null = null;

export function getOllamaStatus(): OllamaStatus { return status; }

function resolveOllamaExe(): string | null {
  // Bundled
  const bundled = path.join(app.getPath('userData'), 'ollama', 'ollama.exe');
  if (fs.existsSync(bundled)) return bundled;
  // Legacy dirs
  const roaming = path.dirname(app.getPath('userData'));
  for (const name of ['Hubtify', 'CalorieTracker', 'calorie-tracker']) {
    const p = path.join(roaming, name, 'ollama', 'ollama.exe');
    if (fs.existsSync(p)) return p;
  }
  // Common Windows paths
  const home = app.getPath('home');
  for (const p of [
    path.join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
  ]) {
    if (fs.existsSync(p)) return p;
  }
  // System PATH
  try {
    const out = execSync('where ollama', { encoding: 'utf-8', timeout: 3000 }).trim().split('\n')[0];
    if (out && fs.existsSync(out.trim())) return out.trim();
  } catch { /* not in PATH */ }
  return null;
}

export function isOllamaAvailable(): boolean {
  return resolveOllamaExe() !== null;
}

const OLLAMA_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

export async function downloadAndInstallOllama(onProgress?: (stage: string) => void): Promise<void> {
  const installerPath = path.join(app.getPath('temp'), 'OllamaSetup.exe');

  onProgress?.('Descargando motor de estimación...');

  const res = await fetch(OLLAMA_INSTALLER_URL);
  if (!res.ok) throw new Error('No se pudo descargar Ollama');

  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Error en la descarga');

  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (total > 0) {
      const pct = Math.round((downloaded / total) * 100);
      onProgress?.(`Descargando motor de estimación... ${pct}%`);
    }
  }

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(installerPath, buffer);

  onProgress?.('Instalando motor de estimación...');

  // Silent install — suppress UI and prevent auto-launch
  execSync(`"${installerPath}" /VERYSILENT /NORESTART /SUPPRESSMSGBOXES`, { timeout: 120000, stdio: 'ignore' });

  // Kill Ollama if the installer auto-launched it — we manage the process ourselves
  try { execSync('taskkill /F /IM ollama.exe /T', { stdio: 'ignore' }); } catch { /* not running */ }

  // Clean up installer
  try { fs.unlinkSync(installerPath); } catch { /* ok */ }

  // Wait for Ollama to be findable
  let retries = 10;
  while (retries-- > 0 && !resolveOllamaExe()) {
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!resolveOllamaExe()) throw new Error('Ollama se instaló pero no se encontró');
}

async function isRunning(): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${port}/api/version`);
    return r.ok;
  } catch { return false; }
}

export function resetTimer(): void {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => stopOllama(), INACTIVITY_TIMEOUT_MS);
}

export function pauseTimer(): void {
  if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
}

export async function ensureOllamaRunning(): Promise<void> {
  resetTimer();
  if (await isRunning()) { status = 'running'; return; }

  if (startupPromise) return startupPromise;

  const exe = resolveOllamaExe();
  if (!exe) { status = 'error'; throw new Error('Ollama no encontrado'); }

  status = 'starting';
  startupPromise = new Promise<void>((resolve, reject) => {
    ollamaProcess = spawn(exe, ['serve'], {
      env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` },
      stdio: 'ignore',
    });
    ollamaProcess.on('error', (err) => { status = 'error'; ollamaProcess = null; reject(err); });
    ollamaProcess.on('exit', () => { if (status !== 'stopped') status = 'error'; ollamaProcess = null; });

    let waited = 0;
    const check = setInterval(async () => {
      waited += 500;
      if (await isRunning()) { clearInterval(check); status = 'running'; resolve(); }
      else if (waited >= 30000) { clearInterval(check); stopOllama(); reject(new Error('Ollama timeout 30s')); }
    }, 500);
  }).finally(() => { startupPromise = null; });

  return startupPromise;
}

export function stopOllama(): void {
  if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  if (ollamaProcess) {
    const pid = ollamaProcess.pid;
    if (pid && process.platform === 'win32') {
      try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' }); } catch { /* already dead */ }
    } else {
      ollamaProcess.kill();
    }
    ollamaProcess = null;
  } else if (process.platform === 'win32') {
    // Kill any ollama process even if we didn't spawn it (e.g. leftover from previous run)
    try { execSync('taskkill /F /IM ollama.exe /T', { stdio: 'ignore' }); } catch { /* none running */ }
  }
  modelReady = false;
  status = 'stopped';
}

// --- Model Management ---

let modelReady = false;

export async function ensureModelPulled(onProgress?: (stage: string) => void): Promise<void> {
  if (modelReady) return;
  // Pull once per session — Ollama only downloads if there's a newer version
  pauseTimer();

  onProgress?.('Descargando modelo de IA (~1.3 GB)... 0%');

  const res = await fetch(`http://localhost:${port}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MODEL, stream: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`No se pudo descargar el modelo ${MODEL}: ${text.slice(0, 200)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No se pudo leer la respuesta de pull');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as { status?: string; total?: number; completed?: number };
          if (data.total && data.completed) {
            const pct = Math.round((data.completed / data.total) * 100);
            onProgress?.(`Descargando modelo de IA... ${pct}%`);
          } else if (data.status) {
            onProgress?.(`${data.status}...`);
          }
        } catch { /* skip malformed line */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  modelReady = true;
  resetTimer();
}

// --- AI Estimation ---

const INSTRUCTION = 'Estimá las calorías de esta comida';

function buildAlpacaPrompt(input: string): string {
  return `### Instruction:\n${INSTRUCTION}\n\n### Input:\n${input}\n\n### Response:\n`;
}

export let lastAiDebug = '';

function sanitizeDescription(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim().replace(/[\x00-\x1F\x7F]/g, '').replace(/\s+/g, ' ');
  if (s.length > 500) s = s.slice(0, 500);
  return s || null;
}

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

const estimationCache = new Map<string, { result: AiResult; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCached(desc: string): AiResult | null {
  const key = desc.toLowerCase().trim();
  const entry = estimationCache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL) { estimationCache.delete(key); return null; }
  return entry.result;
}

function setCache(desc: string, result: AiResult): void {
  const key = desc.toLowerCase().trim();
  estimationCache.set(key, { result, ts: Date.now() });
  if (estimationCache.size > 500) {
    const oldest = [...estimationCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) estimationCache.delete(oldest[0]);
  }
}

export async function estimateWithAi(description: string): Promise<AiResult | null> {
  const sanitized = sanitizeDescription(description);
  if (!sanitized) {
    lastAiDebug = 'Input validation failed';
    return null;
  }

  const cached = getCached(sanitized);
  if (cached) {
    lastAiDebug = '(cached)';
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`http://localhost:${port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: buildAlpacaPrompt(sanitized), stream: false, temperature: 0.1, raw: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      lastAiDebug = `HTTP ${response.status}: ${errorText.slice(0, 200)}`;

      return null;
    }

    const data = await response.json() as { response: string };
    lastAiDebug = data.response?.slice(0, 300) ?? '(empty)';

    const result = parseAiResponse(data.response, sanitized);
    if (result) setCache(sanitized, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function parseItemFromPart(part: string): { name: string; calories: number } | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  // Pattern: "ingrediente ~280kcal" or "ingrediente ~280 kcal"
  const tilde = trimmed.match(/^(.+?)~\s*(\d+)\s*kcal/i);
  if (tilde) return { name: tilde[1].trim(), calories: parseInt(tilde[2]) };

  // Pattern: "ingrediente (100kcal c/u) = 300kcal" or "ingrediente = 300kcal"
  const eq = trimmed.match(/^(.+?)=\s*(\d+)\s*kcal/i);
  if (eq) return { name: eq[1].replace(/\(.*?\)/g, '').trim(), calories: parseInt(eq[2]) };

  // Pattern: "2x ingrediente 500kcal" or "3 x ingrediente 500kcal"
  const qtyPrefix = trimmed.match(/^(\d+)\s*x\s+(.+?)\s+(\d+)\s*kcal/i);
  if (qtyPrefix) return { name: qtyPrefix[2].trim(), calories: parseInt(qtyPrefix[3]) };

  // Pattern: "ingrediente 280kcal" or "ingrediente 280 kcal"
  const simple = trimmed.match(/^(.+?)\s+(\d+)\s*kcal/i);
  if (simple) return { name: simple[1].trim(), calories: parseInt(simple[2]) };

  // Pattern: "ingrediente (280 kcal)"
  const paren = trimmed.match(/^(.+?)\s*\(\s*(\d+)\s*kcal\s*\)/i);
  if (paren) return { name: paren[1].trim(), calories: parseInt(paren[2]) };

  return null;
}

function parseItems(items: unknown, totalCals: number, description: string): Array<{ name: string; calories: number }> {
  // Format: items array [{name, calories}]
  if (Array.isArray(items)) {
    const valid = items.filter((it: any) => typeof it.name === 'string' && typeof it.calories === 'number' && it.calories > 0);
    if (valid.length > 0) return valid.map((it: any) => ({ name: it.name.trim(), calories: Math.round(it.calories) }));
  }
  // Format: breakdown string — split by "+" or newlines, parse each part
  if (typeof items === 'string') {
    const parts = items.split(/\s*\+\s*|\n/).filter(Boolean);
    const parsed: Array<{ name: string; calories: number }> = [];
    for (const part of parts) {
      const item = parseItemFromPart(part);
      if (item && item.calories > 0) parsed.push(item);
    }
    if (parsed.length > 0) return parsed;
  }
  // Format: object {"carne magra": 80}
  if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
    const entries = Object.entries(items as Record<string, number>);
    if (entries.length > 0) return entries.map(([name, cals]) => ({ name, calories: Math.round(cals) }));
  }
  // Fallback: single item with total
  return [{ name: description, calories: totalCals }];
}

function isValidCalories(cal: number): boolean {
  return cal > 0 && cal <= 5000;
}

export function parseAiResponse(raw: string, description: string): AiResult | null {
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();

  // Try direct parse
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.calories === 'number' && isValidCalories(obj.calories)) {
      const items = parseItems(obj.items ?? obj.breakdown, obj.calories, description);
      return { calories: obj.calories, items };
    }
  } catch { /* fall through */ }

  // Try to find JSON object in the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (typeof obj.calories === 'number' && isValidCalories(obj.calories)) {
        const items = parseItems(obj.items ?? obj.breakdown, obj.calories, description);
        return { calories: obj.calories, items };
      }
    } catch { /* fall through */ }
  }

  // Regex extraction
  const match = raw.match(/"calories"\s*:\s*(\d+)/);
  if (match) {
    const cals = parseInt(match[1]);
    if (isValidCalories(cals)) return { calories: cals, items: [{ name: description, calories: cals }] };
  }

  // Last resort
  const calMatch = raw.match(/\b(\d{2,4})\s*(?:kcal|cal|calorias|calorías)/i);
  if (calMatch) {
    const cals = parseInt(calMatch[1]);
    if (cals >= 10 && cals <= 5000) {
      return { calories: cals, items: [{ name: description, calories: cals }] };
    }
  }

  return null;
}
