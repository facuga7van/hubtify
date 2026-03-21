import { useEffect, useRef } from 'react';
import { EventBus } from '../../core/event-bus';
import type { RpgEvent } from '../../../shared/types';

const globalBus = new EventBus();

export function getEventBus(): EventBus {
  return globalBus;
}

export function useEventBus(
  eventType: string,
  handler: (event: RpgEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: RpgEvent) => handlerRef.current(event);
    globalBus.on(eventType, listener);
    return () => globalBus.off(eventType, listener);
  }, [eventType]);
}
