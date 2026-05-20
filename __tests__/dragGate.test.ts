/**
 * @format
 */

import { DragGate } from '../externalModules/rn-custom-map-sdk/src/clustering/dragGate';

describe('DragGate', () => {
  test('starts not dragging', () => {
    const gate = new DragGate();
    expect(gate.isDragging()).toBe(false);
  });

  test('mid-gesture region-change enters drag and suppresses recompute', () => {
    const gate = new DragGate();
    const d = gate.handle({ type: 'region-change', isGesture: true }, 1000);
    expect(d.isDragging).toBe(true);
    expect(d.shouldRecompute).toBe(false);
    expect(d.scheduleSettleCheck).toBe(0);
    expect(gate.isDragging()).toBe(true);
  });

  test('multiple mid-gesture events keep state stable', () => {
    const gate = new DragGate();
    gate.handle({ type: 'region-change', isGesture: true }, 1000);
    gate.handle({ type: 'region-change', isGesture: true }, 1100);
    const d = gate.handle({ type: 'region-change', isGesture: true }, 1200);
    expect(d.shouldRecompute).toBe(false);
    expect(d.isDragging).toBe(true);
  });

  test('programmatic region-change schedules a settle check without entering drag', () => {
    const gate = new DragGate();
    const d = gate.handle({ type: 'region-change', isGesture: false }, 1000);
    expect(d.isDragging).toBe(false);
    expect(d.shouldRecompute).toBe(false);
    expect(d.scheduleSettleCheck).toBeGreaterThan(0);
  });

  test('region-change-complete after a gesture schedules the longer settle period', () => {
    const gate = new DragGate({ debounceMs: 100, gestureSettleMs: 200 });
    gate.handle({ type: 'region-change', isGesture: true }, 1000);
    const d = gate.handle(
      { type: 'region-change-complete', isGesture: true },
      1100,
    );
    expect(d.shouldRecompute).toBe(false);
    expect(d.scheduleSettleCheck).toBe(200);
    expect(d.isDragging).toBe(true);
  });

  test('idle-timeout after a gesture clears drag and triggers a single recompute', () => {
    const gate = new DragGate();
    gate.handle({ type: 'region-change', isGesture: true }, 1000);
    gate.handle({ type: 'region-change-complete', isGesture: true }, 1100);
    const d = gate.handle({ type: 'idle-timeout' }, 1300);
    expect(d.shouldRecompute).toBe(true);
    expect(d.isDragging).toBe(false);
    expect(gate.isDragging()).toBe(false);
  });

  test('a new event after region-change-complete cancels the recompute', () => {
    const gate = new DragGate();
    gate.handle({ type: 'region-change-complete', isGesture: false }, 1000);
    // Camera moves again before the settle check fires.
    gate.handle({ type: 'region-change', isGesture: true }, 1050);
    // Now an idle-timeout fires from the original schedule — but we're
    // dragging again, so the gate's "waitingForSettle" was reset.
    const d = gate.handle({ type: 'idle-timeout' }, 1100);
    // Active gesture → cannot recompute.
    expect(d.shouldRecompute).toBe(false);
    expect(d.isDragging).toBe(true);
  });

  test('stale idle-timeout is a no-op when nothing is pending', () => {
    const gate = new DragGate();
    const d = gate.handle({ type: 'idle-timeout' }, 1000);
    expect(d.shouldRecompute).toBe(false);
    expect(d.isDragging).toBe(false);
  });

  test('programmatic flow: change → complete → idle-timeout recomputes once', () => {
    const gate = new DragGate({ debounceMs: 100, gestureSettleMs: 200 });
    gate.handle({ type: 'region-change', isGesture: false }, 1000);
    gate.handle({ type: 'region-change-complete', isGesture: false }, 1010);
    const d = gate.handle({ type: 'idle-timeout' }, 1200);
    expect(d.shouldRecompute).toBe(true);
    // A second idle-timeout (e.g. stale schedule) does NOT re-fire.
    const d2 = gate.handle({ type: 'idle-timeout' }, 1300);
    expect(d2.shouldRecompute).toBe(false);
  });

  test('options clamp to non-negative and gesture >= debounce', () => {
    const gate = new DragGate({ debounceMs: -50, gestureSettleMs: 0 });
    gate.handle({ type: 'region-change-complete', isGesture: true }, 0);
    // gestureSettleMs was raised to debounceMs (0) at minimum;
    // the schedule should not be negative.
    const state = gate.__debugState();
    expect(state.waitingForSettle).toBe(true);
  });
});
