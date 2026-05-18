import { useCallback, useEffect, useRef } from 'react';
import { findNodeHandle, InteractionManager, Platform } from 'react-native';
import NativeMapViewManager from '../../spec/NativeRNCustomMapViewManager';
import type { MapViewMethods } from '../types';

/**
 * Optional dependency. If the host app uses @react-navigation/native we
 * import useFocusEffect from it; otherwise we fall back to a no-op shim that
 * fires once on mount + cleanup on unmount, which is still correct for
 * non-tabbed apps.
 *
 * This indirection means the SDK does NOT force a hard dependency on
 * react-navigation, but light up automatically when it's present.
 */
let useFocusEffectImpl:
  | ((effect: () => void | (() => void)) => void)
  | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nav = require('@react-navigation/native');
  if (nav && typeof nav.useFocusEffect === 'function') {
    useFocusEffectImpl = nav.useFocusEffect;
  }
} catch {
  // react-navigation not installed — that's fine.
}

type MapRefLike =
  | React.RefObject<MapViewMethods>
  | React.MutableRefObject<MapViewMethods | null>
  | { current: MapViewMethods | null };

type AnyRef = React.RefObject<any> | { current: any };

function resolveTag(ref: AnyRef): number | null {
  if (!ref || !ref.current) return null;
  // MapViewMethods exposes a private __getReactTag for the hook to use.
  // Falls back to findNodeHandle on the raw current value.
  const maybeTag =
    typeof (ref.current as any).__getReactTag === 'function'
      ? (ref.current as any).__getReactTag()
      : null;
  if (typeof maybeTag === 'number') return maybeTag;
  return findNodeHandle(ref.current as any);
}

/**
 * Drives the native MapView's Android lifecycle in lockstep with the React
 * Navigation focus state.
 *
 * Usage:
 *
 *   const mapRef = useRef<MapViewMethods>(null);
 *   useMapTabLifecycle(mapRef);
 *   return <MapView ref={mapRef} ... />;
 *
 * What it does:
 *   - On focus: calls native setActive(true) → onResume + forceRedraw,
 *     which clears the API 30/33 white-screen bug after a tab switch.
 *   - On blur:  calls native setActive(false) → onPause, releasing the GL
 *     surface cleanly so other tabs' maps don't fight for resources.
 *   - On iOS / web: no-op (the bug doesn't reproduce there).
 */
export function useMapTabLifecycle(ref: MapRefLike) {
  const isAndroid = Platform.OS === 'android';

  const activate = useCallback(() => {
    if (!isAndroid) return;
    const tag = resolveTag(ref as AnyRef);
    if (tag == null) return;
    NativeMapViewManager.setActive(tag, true);
    // Schedule a redraw after interactions settle so the SurfaceView has
    // time to re-acquire its GL surface after the navigator's transition
    // animation finishes.
    InteractionManager.runAfterInteractions(() => {
      const tag2 = resolveTag(ref as AnyRef);
      if (tag2 != null) {
        NativeMapViewManager.forceRedraw(tag2);
      }
    });
  }, [isAndroid, ref]);

  const deactivate = useCallback(() => {
    if (!isAndroid) return;
    const tag = resolveTag(ref as AnyRef);
    if (tag == null) return;
    NativeMapViewManager.setActive(tag, false);
  }, [isAndroid, ref]);

  // Path 1: react-navigation is present → wire to focus/blur.
  if (useFocusEffectImpl) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useFocusEffectImpl(
      // useCallback inside is required by react-navigation
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useCallback(() => {
        activate();
        return () => deactivate();
      }, [activate, deactivate]),
    );
    return;
  }

  // Path 2: no react-navigation → activate on mount, deactivate on unmount.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const didRun = useRef(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;
    activate();
    return () => deactivate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
