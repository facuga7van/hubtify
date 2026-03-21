import type { RpgEvent } from '../../shared/types';

type EventListener = (event: RpgEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>();

  on(eventType: string, listener: EventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
  }

  off(eventType: string, listener: EventListener): void {
    this.listeners.get(eventType)?.delete(listener);
  }

  emit(event: RpgEvent): void {
    const notify = (listeners: Set<EventListener> | undefined) => {
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error(`[EventBus] Error in listener for "${event.type}":`, err);
        }
      }
    };

    notify(this.listeners.get(event.type));
    notify(this.listeners.get('*'));
  }
}
