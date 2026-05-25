import {
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import type { AdvancedMarkerMethods, AdvancedMarkerProps } from './types';
import { MapContext } from './AdvancedMarkerContext';

/**
 * <AdvancedMarker>
 * ----------------
 * Google Maps Advanced Marker component (cross-platform).
 *
 * <p><b>Two ways to use it.</b>
 *
 * <pre>{@code
 *   // Pattern A — inline children of MapView
 *   <MapView>
 *     <AdvancedMarker coordinate={...}>
 *       <Avatar />
 *     </AdvancedMarker>
 *   </MapView>
 *
 *   // Pattern B — wrapped inside any custom component, fragment, or HOC
 *   <MapView>
 *     {users.map(u => <MyDriverPin key={u.id} user={u} />)}
 *   </MapView>
 *   // where MyDriverPin renders an <AdvancedMarker> internally.
 * }</pre>
 *
 * Pattern A is picked up by the parent {@code <MapView>}'s child
 * walker. Pattern B is picked up via React Context — see
 * {@link AdvancedMarkerContext}. The two paths merge inside MapView
 * (registry wins on id collision, so the most up-to-date children
 * reference is always rendered).
 *
 * <p>This component renders {@code null} — its visual content is
 * hoisted into the MapView's overlay / bitmap subtree based on the
 * {@code tracksViewChanges} setting.
 */
const AdvancedMarker = forwardRef<AdvancedMarkerMethods, AdvancedMarkerProps>(
  function AdvancedMarker(props, ref) {
    const ctx = useContext(MapContext);

    // Auto-generate a stable id when the caller doesn't supply one
    // (or supplies an empty string, which the user's pattern produces
    // for "user-location" type markers). Generated ids are scoped to
    // this component instance so the same logical marker keeps the
    // same id across re-renders.
    const autoIdRef = useRef<string | null>(null);
    if (autoIdRef.current === null) {
      autoIdRef.current = `auto-adv-${++__advMarkerSeq}`;
    }
    const id =
      props.identifier != null && props.identifier !== ''
        ? props.identifier
        : autoIdRef.current;

    // The component itself doesn't actually expose any imperative
    // method right now, but we keep the ref shape for forward-compat
    // (callout, redraw, etc. once they're wired through).
    useImperativeHandle(ref, () => ({}), []);

    /**
     * Effect 1 — handle mount / unmount.
     *
     * <p>Keyed on {@code ctx} and {@code id} only. The unmount
     * cleanup removes the entry so a stale id never lingers in the
     * registry.
     */
    useEffect(() => {
      if (!ctx) return undefined;
      return () => ctx.removeAdvancedMarker(id);
    }, [ctx, id]);

    /**
     * Effect 2 — push the latest entry into the registry whenever a
     * displayable prop actually changes.
     *
     * <p>The dependency array intentionally enumerates primitive
     * fields plus the {@code children} reference. Including
     * {@code children} means a parent re-render that produces new
     * JSX for the marker visual also notifies the map. That's safe
     * because the {@code <AdvancedMarker>} elements coming from the
     * grandparent's render are not re-created when MapView itself
     * re-renders — only when the grandparent re-renders — so we
     * don't infinite-loop.
     */
    const latitude = props.coordinate.latitude;
    const longitude = props.coordinate.longitude;
    const onPress = props.onPress;
    const onSelect = props.onSelect;
    const onDeselect = props.onDeselect;
    const onDragStart = props.onDragStart;
    const onDrag = props.onDrag;
    const onDragEnd = props.onDragEnd;

    // Memo the props object we ship into the registry so referential
    // equality is preserved across no-op renders.
    const stableProps = useMemo<AdvancedMarkerProps>(
      () => ({
        ...props,
        identifier: id,
        coordinate: { latitude, longitude },
        onPress,
        onSelect,
        onDeselect,
        onDragStart,
        onDrag,
        onDragEnd,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        id,
        latitude,
        longitude,
        props.title,
        props.description,
        props.pinColor,
        props.draggable,
        props.flat,
        props.rotation,
        props.opacity,
        // anchor & zIndex are objects/primitives the user usually
        // declares inline — comparing the entire props bag would
        // re-register every render. Tracking the literal sub-props
        // covers the common case without surprises.
        props.zIndex,
        props.tracksViewChanges,
        props.data,
        onPress,
        onSelect,
        onDeselect,
        onDragStart,
        onDrag,
        onDragEnd,
      ],
    );

    useEffect(() => {
      if (!ctx) return;
      ctx.upsertAdvancedMarker(id, {
        id,
        props: stableProps,
        children: props.children,
      });
      // children intentionally excluded from the dep list above —
      // see the explanation in the registry; it's included here so
      // visual-content updates flow through.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctx, id, stableProps, props.children]);

    return null;
  },
);

AdvancedMarker.displayName = 'RNCustomMapAdvancedMarker';

// Module-level counter for auto-generated ids. Safe to use here because
// this code runs on a single JS thread (the RN bridge).
let __advMarkerSeq = 0;

export default AdvancedMarker;
