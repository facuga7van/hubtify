import { describe, it, expect, vi, afterEach } from 'vitest';
import { emit, setEventSink } from '../../shared-logic/events';

afterEach(() => setEventSink(null));

describe('events.emit', () => {
  it('is a no-op when no sink is installed', () => {
    expect(() => emit('rpg:pardonUsed')).not.toThrow();
  });

  it('forwards channel and payload to the sink', () => {
    const sink = vi.fn();
    setEventSink(sink);
    emit('cauldron:tick', { status: 'work' });
    expect(sink).toHaveBeenCalledWith('cauldron:tick', { status: 'work' });
  });

  it('passes payload as undefined when the caller sends none', () => {
    const sink = vi.fn();
    setEventSink(sink);
    emit('rpg:obolosChanged');
    expect(sink).toHaveBeenCalledWith('rpg:obolosChanged', undefined);
  });

  it('never lets a throwing sink break the caller', () => {
    setEventSink(() => { throw new Error('renderer gone'); });
    expect(() => emit('rpg:daySealed', { date: '2026-09-01' })).not.toThrow();
  });
});
