import type { HubtifyApi } from './types';
import { API_CHANNELS, type ChannelSpec } from './api-channels';

export type EventHandler = (payload: unknown) => void;

/** What a binding must provide: ipcRenderer on Electron, postMessage on Android. */
export interface Transport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, handler: EventHandler): void;
  off(channel: string, handler: EventHandler): void;
}

export type ApiTarget = 'desktop' | 'mobile';

/**
 * Builds `window.api` from API_CHANNELS. On 'mobile' the desktop-only entries
 * are omitted (their HubtifyApi members are optional) and `send` is a no-op
 * (`window:*` has no meaning without a frame).
 */
export function buildApi(transport: Transport, target: ApiTarget): HubtifyApi {
  const api: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(API_CHANNELS) as Array<[string, ChannelSpec]>) {
    if (spec.platforms === 'desktop' && target !== 'desktop') continue;
    api[key] = makeMethod(transport, spec, target);
  }
  return api as unknown as HubtifyApi;
}

function makeMethod(transport: Transport, spec: ChannelSpec, target: ApiTarget): unknown {
  switch (spec.kind) {
    case 'invoke':
      return (...args: unknown[]) => transport.invoke(spec.channel, ...args);
    case 'send':
      return target === 'desktop'
        ? (...args: unknown[]) => transport.send(spec.channel, ...args)
        : () => undefined;
    case 'on':
      return (callback: (payload: unknown) => void) => {
        const handler: EventHandler = (payload) => callback(spec.unwrap ? spec.unwrap(payload) : payload);
        transport.on(spec.channel, handler);
        return () => transport.off(spec.channel, handler);
      };
  }
}
