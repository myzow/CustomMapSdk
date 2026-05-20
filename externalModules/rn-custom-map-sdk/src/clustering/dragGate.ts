/**
 * Drag gate — pure state machine that decides when the clustering pipeline
 * is allowed to recompute. The map fires a flurry of region-change events
 * during a pan/pinch gesture; running clustering on each one is the root
 * cause of marker flicker. The gate enforces two invariants:
 *
 *   1. While a gesture is in flight, never recompute. Events are tracked
 *      (so the live region stays current for tooltips, etc.) but cluster
 *      production is suppressed.
 *
 *   2. Exactly ONE recompute fires on the trailing edge of a gesture,
 *      after the camera settles. Successive idle events without a gesture
 *      collapse into a single deferred recompute via the debounce.
 *
 * Everything is pure (no React, no timers held inside) so the host wires
 * a single setTimeout against the {@link DragGate#scheduleSettleCheck}
 * delay value. This keeps the gate trivially unit-testable.
 */

export type GateEvent =
  | { type: 'region-change'; isGesture: boolean }
  | { type: 'region-change-complete'; isGesture: boolean }
  | { type: 'idle-timeout' };

export type GateDecision = {
  /** True when the caller may run the clustering algorithm immediately. */
  shouldRecompute: boolean;
  /**
   * When non-zero, the caller should set a single-shot timer for this many
   * milliseconds and dispatch a `{ type: 'idle-timeout' }` event when it
   * fires. Restarting the timer cancels any previously-scheduled one.
   */
  scheduleSettleCheck: number;
  /**
   * True while a user gesture is in flight. The renderer uses this to
   * suppress unnecessary work (e.g. avoid mutating native marker icons
   * mid-drag).
   */
  isDragging: boolean;
};

export type DragGateOptions = {
  /**
   * Quiet period after a non-gesture region change before we accept the
   * camera as "settled". Default 100 ms.
   */
  debounceMs?: number;
  /**
   * Quiet period after the LAST gesture event before we accept the gesture
   * as finished. Tuned slightly larger than `debounceMs` because Android &
   * iOS both emit a final `region-change` after `region-change-complete`
   * on fling gestures. Default 150 ms.
   */
  gestureSettleMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_GESTURE_SETTLE_MS = 150;

/**
 * Stateful gate. Construct once per MapView; feed it events; act on the
 * returned decision. The gate itself does not own timers — that's the
 * host's responsibility.
 */
export class DragGate {
  private dragging = false;
  /** Wall-clock timestamp of the last event seen, used by tests. */
  private lastEventAt = 0;
  /** Last event type — used to bias the trailing recompute. */
  private lastEventWasGesture = false;
  /** True until the first idle-timeout has been processed. */
  private waitingForSettle = false;

  private readonly debounceMs: number;
  private readonly gestureSettleMs: number;

  constructor(opts?: DragGateOptions) {
    this.debounceMs = Math.max(opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS, 0);
    this.gestureSettleMs = Math.max(
      opts?.gestureSettleMs ?? DEFAULT_GESTURE_SETTLE_MS,
      this.debounceMs,
    );
  }

  isDragging(): boolean {
    return this.dragging;
  }

  /**
   * Submit an event. Returns a decision describing what the host should do
   * next: recompute now, schedule a settle timer, or simply update state.
   */
  handle(event: GateEvent, now: number = Date.now()): GateDecision {
    this.lastEventAt = now;
    switch (event.type) {
      case 'region-change': {
        // Mid-gesture events: enter / stay in drag mode.
        if (event.isGesture) {
          this.dragging = true;
          this.lastEventWasGesture = true;
          this.waitingForSettle = false;
          return {
            shouldRecompute: false,
            scheduleSettleCheck: 0,
            isDragging: true,
          };
        }
        // Programmatic (animateToRegion) — schedule a single settle check.
        this.lastEventWasGesture = false;
        this.waitingForSettle = true;
        return {
          shouldRecompute: false,
          scheduleSettleCheck: this.debounceMs,
          isDragging: this.dragging,
        };
      }

      case 'region-change-complete': {
        // The camera reports idle. If we got here from a gesture, wait the
        // longer "gestureSettleMs" period — Android emits a stray onIdle
        // immediately after the gesture ends but before the inertial fling.
        this.lastEventWasGesture = event.isGesture || this.dragging;
        this.waitingForSettle = true;
        const wait = this.lastEventWasGesture
          ? this.gestureSettleMs
          : this.debounceMs;
        return {
          shouldRecompute: false,
          scheduleSettleCheck: wait,
          isDragging: this.dragging,
        };
      }

      case 'idle-timeout': {
        // The host's deferred timer fired. If another event arrived since
        // we scheduled it, `waitingForSettle` is still true. We only
        // recompute when nothing has rescheduled.
        if (!this.waitingForSettle) {
          return {
            shouldRecompute: false,
            scheduleSettleCheck: 0,
            isDragging: this.dragging,
          };
        }
        this.waitingForSettle = false;
        // Settle period elapsed → drag is officially over.
        this.dragging = false;
        return {
          shouldRecompute: true,
          scheduleSettleCheck: 0,
          isDragging: false,
        };
      }
    }
  }

  /** @internal — for tests */
  __debugState() {
    return {
      dragging: this.dragging,
      lastEventAt: this.lastEventAt,
      lastEventWasGesture: this.lastEventWasGesture,
      waitingForSettle: this.waitingForSettle,
    };
  }
}
