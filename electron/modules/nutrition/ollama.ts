import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { OllamaStatus } from '../../../shared/types';

const MODEL = 'llama3.2:1b';
const DEFAULT_PORT = 11434;
let port = DEFAULT_PORT;
const INACTIVITY_TIMEOUT_MS = 15 * 1000; // 15s after last use

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

  // Check if model exists
  try {
    const res = await fetch(`http://localhost:${port}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: MODEL }),
    });
    if (res.ok) {
      modelReady = true;
      console.log('[Ollama] Model already available:', MODEL);
      return;
    }
  } catch { /* not available */ }

  // Pause inactivity timer during pull — it can take several minutes
  pauseTimer();

  // Pull the model with streaming to track progress
  console.log('[Ollama] Pulling model:', MODEL);
  onProgress?.('Descargando modelo de IA (~670 MB)... 0%');

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
          console.log(`[Ollama] Pull progress: ${pct}%`);
        } else if (data.status) {
          onProgress?.(`${data.status}...`);
          console.log(`[Ollama] Pull status: ${data.status}`);
        }
      } catch { /* skip malformed line */ }
    }
  }

  modelReady = true;
  resetTimer();
  console.log('[Ollama] Model pulled successfully:', MODEL);
}

// --- AI Estimation ---

const SYSTEM_PROMPT = `Sos un nutricionista argentino. Estimás calorías de comidas.
Respondé SOLO con JSON válido. Sin texto adicional, sin explicaciones, sin markdown.

REGLAS:
- Estimá ÚNICAMENTE lo descrito. PROHIBIDO inventar ingredientes.
- Para marcas/cadenas, usá calorías reales.
- Respetá tamaños y cantidades indicadas. "pedacitos" = porciones pequeñas.
- Ante la duda, estimá hacia arriba.

EJEMPLOS:
Usuario: dos milanesas con ensalada
{"calories": 750, "breakdown": "2 milanesas ~700kcal + ensalada ~50kcal"}

Usuario: 3 pedacitos de carne
{"calories": 180, "breakdown": "3 trozos pequeños de carne ~180kcal"}

Usuario: un vaso de jugo de naranja
{"calories": 120, "breakdown": "jugo de naranja 350ml ~120kcal"}

Usuario: big mac con papas medianas
{"calories": 900, "breakdown": "Big Mac ~550kcal + papas medianas ~350kcal"}

Respondé SOLO el JSON.`;

export let lastAiDebug = '';

export async function estimateWithAi(description: string): Promise<{ calories: number; breakdown: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`http://localhost:${port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: `Usuario: ${description}`, system: SYSTEM_PROMPT, stream: false, temperature: 0.3 }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      lastAiDebug = `HTTP ${response.status}: ${errorText.slice(0, 200)}`;
      console.log('[AI] Error response:', lastAiDebug);
      return null;
    }

    const data = await response.json() as { response: string };
    lastAiDebug = data.response?.slice(0, 300) ?? '(empty)';
    console.log('[AI] Raw response:', data.response);
    return parseAiResponse(data.response);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBreakdown(breakdown: unknown, totalCals: number): string | null {
  if (typeof breakdown === 'string') return breakdown;
  if (typeof breakdown === 'object' && breakdown !== null) {
    // Model returned {"carne magra": 80, "otro": 40} — convert to readable string
    const entries = Object.entries(breakdown as Record<string, number>);
    if (entries.length > 0) {
      return entries.map(([name, cals]) => `${name} ~${cals}kcal`).join(' + ');
    }
  }
  return `~${totalCals}kcal`;
}

function isValidCalories(cal: number): boolean {
  return cal > 0 && cal <= 5000;
}

export function parseAiResponse(raw: string): { calories: number; breakdown: string } | null {
  // Strip markdown code fences that small models sometimes add
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();

  // Try direct parse
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.calories === 'number' && isValidCalories(obj.calories)) {
      const breakdown = normalizeBreakdown(obj.breakdown, obj.calories);
      if (breakdown) return { calories: obj.calories, breakdown };
    }
  } catch { /* fall through */ }

  // Try to find JSON object in the response (model might add text around it)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (typeof obj.calories === 'number' && isValidCalories(obj.calories)) {
        const breakdown = normalizeBreakdown(obj.breakdown, obj.calories);
        if (breakdown) return { calories: obj.calories, breakdown };
      }
    } catch { /* fall through */ }
  }

  // Try regex extraction (calories first)
  const match = raw.match(/"calories"\s*:\s*(\d+)/);
  const matchBreakdown = raw.match(/"breakdown"\s*:\s*"([^"]*)"/);
  if (match && matchBreakdown) {
    const cals = parseInt(match[1]);
    if (isValidCalories(cals)) return { calories: cals, breakdown: matchBreakdown[1] };
  }

  // Last resort: find a number between 10-5000 that looks like calories
  const calMatch = raw.match(/\b(\d{2,4})\s*(?:kcal|cal|calorias|calorías)/i);
  if (calMatch) {
    const cals = parseInt(calMatch[1]);
    if (cals >= 10 && cals <= 5000) {
      return { calories: cals, breakdown: raw.slice(0, 100).replace(/[{}"]/g, '').trim() };
    }
  }

  return null;
}
