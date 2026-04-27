import { app } from 'electron';
import os from 'os';
import { ipcHandle } from '../ipc/ipc-handle';

const FEEDBACK_URL = 'https://wampaland.duckdns.org:7849/api/feedback';

interface FeedbackPayload {
  type: 'bug' | 'feature' | 'other';
  description: string;
  email?: string;
}

export function registerFeedbackIpcHandlers(): void {
  ipcHandle('feedback:send', async (_event, payload: FeedbackPayload) => {
    const body = {
      type: payload.type,
      description: payload.description,
      email: payload.email || undefined,
      appVersion: app.getVersion(),
      os: `${process.platform} ${os.release()}`,
    };

    const res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Feedback failed (HTTP ${res.status}): ${text}`);
    }

    return { success: true };
  });
}
