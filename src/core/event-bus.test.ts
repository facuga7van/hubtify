import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from './event-bus';
import type { RpgEvent } from '../../shared/types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('calls listeners for matching event type', () => {
    const listener = vi.fn();
    bus.on('TASK_COMPLETED', listener);
    const event: RpgEvent = { type: 'TASK_COMPLETED', moduleId: 'quests', payload: { taskId: '1' }, timestamp: Date.now() };
    bus.emit(event);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('does not call listeners for non-matching type', () => {
    const listener = vi.fn();
    bus.on('MEAL_LOGGED', listener);
    bus.emit({ type: 'TASK_COMPLETED', moduleId: 'quests', payload: {}, timestamp: Date.now() });
    expect(listener).not.toHaveBeenCalled();
  });

  it('wildcard listener receives all events', () => {
    const listener = vi.fn();
    bus.on('*', listener);
    bus.emit({ type: 'A', moduleId: 'x', payload: {}, timestamp: 1 });
    bus.emit({ type: 'B', moduleId: 'y', payload: {}, timestamp: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('off removes listener', () => {
    const listener = vi.fn();
    bus.on('TASK_COMPLETED', listener);
    bus.off('TASK_COMPLETED', listener);
    bus.emit({ type: 'TASK_COMPLETED', moduleId: 'quests', payload: {}, timestamp: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('handles errors in listeners without breaking other listeners', () => {
    const badListener = vi.fn(() => { throw new Error('boom'); });
    const goodListener = vi.fn();
    bus.on('TEST', badListener);
    bus.on('TEST', goodListener);
    bus.emit({ type: 'TEST', moduleId: 'test', payload: {}, timestamp: 1 });
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();
  });
});
