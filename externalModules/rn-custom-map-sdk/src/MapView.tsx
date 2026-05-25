import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  findNodeHandle,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import NativeMapView from '../spec/RNCustomMapViewNativeComponent';
import NativeMapViewManager from '../spec/NativeRNCustomMapViewManager';
import Callout from './Callout';
import Circle from './Circle';
import Marker from './Marker';
import AdvancedMarker from './AdvancedMarker';
import Polyline from './Polyline';
import MarkerPlaceholder from './Placeholder';
import {
  clusterPoints,
  type Cluster as EngineCluster,
  type ClusterPoint,
} from './clustering/cluster';
import {
  shouldRecompute,
  zoomBucketKey,
  regionToZoom,
} from './clustering/throttle';
import { DragGate } from './clustering/dragGate';
import { stableClusterKey } from './clustering/membership';
import { resolveCluster } from './clustering/markerType';
import { defaultIconCache } from './clustering/iconCache';
import {
  MapContext,
  type AdvancedMarkerRegistration,
  type MapContextValue,
} from './AdvancedMarkerContext';
import type {
  AdvancedMarkerProps,
  Camera,
  CameraOptions,
  CircleProps,
  Cluster,
  ClusterConfig,
  Coordinate,
  MapViewMethods,
  MapViewProps,
  MarkerAnimationOptions,
  MarkerFallback,
  MarkerMethods,
  MarkerProps,
  NativeAdvancedMarker,
  NativeCircle,
  NativeMarker,
  NativePolyline,
  PolylineProps,
  Region,
  RegionChangeDetails,
} from './types';

const DEFAULT_DURATION = 500;
const DEFAULT_FIT_PADDING = 50;
const DEFAULT_CLUSTER_RADIUS = 60;
const CLUSTER_MARKER_PREFIX = 'cluster:';
const ADVANCED_CLUSTER_MARKER_PREFIX = 'acluster:';
const DEFAULT_RENDER_THRESHOLD = 0.5;
const DEFAULT_DRAG_THRESHOLD = 50;
const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_ZOOM_STEP_ON_PRESS = 2;
const DEFAULT_MAX_ZOOM = 20;
const DEFAULT_CLUSTER_EXPAND_PADDING = 80;
const DEFAULT_MAP_ID = 'DEMO_MAP_ID';

type EventPayload<T> = NativeSyntheticEvent<T>;

type MarkerSnapshot = {
  id: string;
  children: React.ReactNode;
};

type MarkerMeta = {
  id: string;
  coordinate: Coordinate;
  data?: any;
  title?: string;
  imageUri?: string;
  fallback?: MarkerFallback;
  isCustom: boolean;
};

type AdvancedMarkerMeta = {
  id: string;
  coordinate: Coordinate;
  data?: any;
  title?: string;
  isCustom: boolean;
};

function childTypeName(child: React.ReactElement) {
  const type = child.type as any;
  return type?.displayName || type?.name;
}

function resolveImageSource(source: MarkerProps['image']): string | undefined {
  if (!source) return undefined;
  const resolved = Image.resolveAssetSource(source);
  return resolved?.uri;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function getMarkerCallout(marker: React.ReactElement<MarkerProps>) {
  let tooltip = false;
  let onPress: MarkerProps['onCalloutPress'];
  React.Children.forEach(marker.props.children, child => {
    if (!React.isValidElement(child)) return;
    if (
      child.type === Callout ||
      childTypeName(child) === 'RNCustomMapCallout'
    ) {
      tooltip = Boolean((child.props as any).tooltip);
      onPress = (child.props as any).onPress;
    }
  });
  return { tooltip, onPress };
}

function isCalloutChild(child: React.ReactNode) {
  return (
    React.isValidElement(child) &&
    (child.type === Callout || childTypeName(child) === 'RNCustomMapCallout')
  );
}

function getMarkerCustomChildren(
  marker: React.ReactElement<MarkerProps | AdvancedMarkerProps>,
) {
  const customChildren = React.Children.toArray(marker.props.children).filter(
    child => !isCalloutChild(child),
  );
  return customChildren.length > 0 ? customChildren : null;
}

function isAdvancedMarkerNode(
  child: React.ReactElement,
): child is React.ReactElement<AdvancedMarkerProps> {
  return (
    child.type === AdvancedMarker ||
    childTypeName(child) === 'RNCustomMapAdvancedMarker'
  );
}

function isMarkerNode(
  child: React.ReactElement,
): child is React.ReactElement<MarkerProps> {
  return (
    child.type === Marker || childTypeName(child) === 'RNCustomMapMarker'
  );
}

function parseChildren(children: React.ReactNode) {
  const markers: NativeMarker[] = [];
  const advancedMarkers: NativeAdvancedMarker[] = [];
  const polylines: NativePolyline[] = [];
  const circles: NativeCircle[] = [];
  const markerPressHandlers = new Map<string, MarkerProps['onPress']>();
  const markerSelectHandlers = new Map<string, MarkerProps['onSelect']>();
  const markerDeselectHandlers = new Map<string, MarkerProps['onDeselect']>();
  const markerDragStartHandlers = new Map<string, MarkerProps['onDragStart']>();
  const markerDragHandlers = new Map<string, MarkerProps['onDrag']>();
  const markerDragEndHandlers = new Map<string, MarkerProps['onDragEnd']>();
  const calloutPressHandlers = new Map<string, () => void>();
  const polylinePressHandlers = new Map<string, PolylineProps['onPress']>();
  const markerRefs = new Map<string, React.Ref<MarkerMethods>>();
  const markerSnapshots: MarkerSnapshot[] = [];
  const advancedMarkerSnapshots: MarkerSnapshot[] = [];
  const markerMeta = new Map<string, MarkerMeta>();
  const advancedMarkerMeta = new Map<string, AdvancedMarkerMeta>();

  /**
   * Walks the JSX tree depth-first looking for known map elements.
   *
   * <p>This is recursive so wrappers like {@code <View key={user.id}>} or
   * {@code <Fragment>} or any plain pass-through component the consumer
   * uses for organization are transparent — the parser keeps drilling
   * until it finds an {@code <AdvancedMarker>} / {@code <Marker>} /
   * {@code <Polyline>} / {@code <Circle>}. This is what enables the
   * "current syntax should also work" requirement:
   *
   * <pre>{@code
   *   <View key={user.userId}>
   *     <AdvancedMarker coordinate={coords} tracksViewChanges>
   *       <CustomActivityIndicator />
   *     </AdvancedMarker>
   *   </View>
   * }</pre>
   *
   * <p>When a known marker element is found we do <b>not</b> recurse
   * into its children — those children ARE the custom marker view and
   * belong to the marker, not to the map's child set.
   */
  let walkIndex = 0;
  const visit = (node: React.ReactNode) => {
    React.Children.forEach(node, child => {
      if (!React.isValidElement(child)) return;
      const index = walkIndex++;

      if (isAdvancedMarkerNode(child)) {
        const props = child.props;
        const id = props.identifier ?? `advanced-marker-${index}`;
        const customChildren = getMarkerCustomChildren(child);
        advancedMarkers.push(
          compactObject({
            id,
            latitude: props.coordinate.latitude,
            longitude: props.coordinate.longitude,
            title: props.title,
            description: props.description,
            pinColor: props.pinColor,
            draggable: props.draggable,
            flat: props.flat,
            rotation: props.rotation,
            opacity: props.opacity,
            anchor: props.anchor,
            zIndex: props.zIndex,
            hasCustomView: customChildren !== null,
            tracksViewChanges: props.tracksViewChanges,
          }) as NativeAdvancedMarker,
        );
        advancedMarkerMeta.set(id, {
          id,
          coordinate: props.coordinate,
          data: props.data,
          title: props.title,
          isCustom: customChildren !== null,
        });
        if (customChildren) {
          advancedMarkerSnapshots.push({ id, children: customChildren });
        }
        if (props.onPress) markerPressHandlers.set(id, props.onPress);
        if (props.onSelect) markerSelectHandlers.set(id, props.onSelect);
        if (props.onDeselect) markerDeselectHandlers.set(id, props.onDeselect);
        if (props.onDragStart) markerDragStartHandlers.set(id, props.onDragStart);
        if (props.onDrag) markerDragHandlers.set(id, props.onDrag);
        if (props.onDragEnd) markerDragEndHandlers.set(id, props.onDragEnd);
        return;
      }

      if (isMarkerNode(child)) {
        const props = child.props;
        const id = props.identifier ?? props.id ?? `marker-${index}`;
        const callout = getMarkerCallout(child);
        const customChildren = getMarkerCustomChildren(child);
        const markerRef = (child as any).ref ?? (child.props as any).ref;
        const fallback = props.fallback;

        markers.push(
          compactObject({
            id,
            latitude: props.coordinate.latitude,
            longitude: props.coordinate.longitude,
            title: props.title,
            description: props.description,
            pinColor: props.pinColor,
            image: resolveImageSource(props.image),
            icon: resolveImageSource(props.icon),
            fallbackColor: fallback?.color,
            fallbackInitial: fallback?.initial,
            fallbackRingColor: fallback?.ringColor,
            centerOffset: props.centerOffset,
            calloutOffset: props.calloutOffset,
            anchor: props.anchor,
            calloutAnchor: props.calloutAnchor,
            draggable: props.draggable,
            flat: props.flat,
            rotation: props.rotation,
            opacity: props.opacity,
            tappable: props.tappable,
            tracksViewChanges: props.tracksViewChanges,
            calloutTooltip: callout.tooltip,
          }),
        );

        const data = props.data !== undefined ? props.data : props.userData;
        const resolvedImageUri =
          resolveImageSource(props.image) ?? resolveImageSource(props.icon);
        markerMeta.set(id, {
          id,
          coordinate: props.coordinate,
          data,
          title: props.title,
          imageUri: resolvedImageUri,
          fallback,
          isCustom: customChildren !== null,
        });

        if (markerRef) markerRefs.set(id, markerRef);
        if (customChildren)
          markerSnapshots.push({ id, children: customChildren });
        if (props.onPress) markerPressHandlers.set(id, props.onPress);
        if (props.onSelect) markerSelectHandlers.set(id, props.onSelect);
        if (props.onDeselect) markerDeselectHandlers.set(id, props.onDeselect);
        if (props.onDragStart) markerDragStartHandlers.set(id, props.onDragStart);
        if (props.onDrag) markerDragHandlers.set(id, props.onDrag);
        if (props.onDragEnd) markerDragEndHandlers.set(id, props.onDragEnd);
        if (props.onCalloutPress || callout.onPress) {
          calloutPressHandlers.set(
            id,
            (props.onCalloutPress ?? callout.onPress)!,
          );
        }
        return;
      }

      if (child.type === Polyline || childTypeName(child) === 'RNCustomMapPolyline') {
        const props = child.props as PolylineProps;
        const id = props.id ?? `polyline-${index}`;
        polylines.push(
          compactObject({
            id,
            coordinates: props.coordinates,
            strokeColor: props.strokeColor,
            strokeWidth: props.strokeWidth,
            lineDashPattern: props.lineDashPattern,
            geodesic: props.geodesic,
            zIndex: props.zIndex,
            tappable: props.tappable,
          }),
        );
        if (props.onPress) polylinePressHandlers.set(id, props.onPress);
        return;
      }

      if (child.type === Circle || childTypeName(child) === 'RNCustomMapCircle') {
        const props = child.props as CircleProps;
        circles.push(
          compactObject({
            id: props.id ?? `circle-${index}`,
            center: props.center,
            radius: props.radius,
            strokeColor: props.strokeColor,
            strokeWidth: props.strokeWidth,
            fillColor: props.fillColor,
            zIndex: props.zIndex,
          }),
        );
        return;
      }

      // Unknown element — could be a wrapper like <View>, a Fragment, or
      // a consumer-defined HOC. Recurse into its children so the user can
      // group marker children for keying / readability without breaking
      // the parser. We do NOT recurse into known marker elements (their
      // children are the marker's custom view, not map children).
      const childChildren = (child.props as { children?: React.ReactNode })
        ?.children;
      if (childChildren != null) {
        visit(childChildren);
      }
    });
  };

  visit(children);

  return {
    markers,
    advancedMarkers,
    polylines,
    circles,
    markerPressHandlers,
    markerSelectHandlers,
    markerDeselectHandlers,
    markerDragStartHandlers,
    markerDragHandlers,
    markerDragEndHandlers,
    calloutPressHandlers,
    polylinePressHandlers,
    markerRefs,
    markerSnapshots,
    advancedMarkerSnapshots,
    markerMeta,
    advancedMarkerMeta,
  };
}

function setMarkerRef(
  ref: React.Ref<MarkerMethods>,
  value: MarkerMethods | null,
) {
  if (typeof ref === 'function') ref(value);
  else if (ref && 'current' in ref) {
    (ref as React.MutableRefObject<MarkerMethods | null>).current = value;
  }
}

function markerAnimationOptions(
  durationOrOptions: number | MarkerAnimationOptions | undefined,
): MarkerAnimationOptions {
  if (typeof durationOrOptions === 'number')
    return { duration: durationOrOptions };
  return { duration: DEFAULT_DURATION, ...durationOrOptions };
}

function fitOptions(
  options?:
    | number
    | { animated?: boolean; padding?: number; edgePadding?: any },
) {
  if (typeof options === 'number') {
    return { animated: true, padding: options, edgePadding: undefined };
  }
  return {
    animated: options?.animated ?? true,
    padding: options?.padding ?? DEFAULT_FIT_PADDING,
    edgePadding: options?.edgePadding,
  };
}

function DefaultClusterBubble({ cluster }: { cluster: Cluster }) {
  if (cluster.pointCount === 1) {
    const member = cluster.markers[0];
    const meta = member?.data as { fallback?: MarkerFallback } | undefined;
    const fallback = meta?.fallback;
    return <MarkerPlaceholder fallback={fallback} />;
  }
  return (
    <View style={defaultClusterStyles.bubble}>
      <Text style={defaultClusterStyles.text}>{cluster.pointCount}</Text>
    </View>
  );
}

// ============================================================================
// Frozen static-bitmap snapshot
// ============================================================================

/**
 * A snapshot view for `tracksViewChanges={false}` advanced markers.
 *
 * <p>The contract of {@code tracksViewChanges=false} is "rasterize the
 * marker's visual once, then never again". To honour that we wrap the
 * children in a {@link memo} with {@code () => true} so the component
 * NEVER re-renders after its first mount, and we capture the children
 * via lazy {@code useState} init so subsequent prop pushes from
 * MapView (which happen whenever a parent re-render creates new
 * closures for {@code onPress}, etc.) are silently ignored.
 *
 * <p>Why this matters: even though the native side caches rasterized
 * bitmaps by content signature, re-rendering the React subtree still
 * walks the entire child tree, fires {@code Image.onLoad} listeners,
 * triggers layout, and re-emits the ref callback — each of those is
 * an opportunity for a visible micro-flicker during fast pan/zoom.
 * Freezing the subtree eliminates the entire class of issue.
 *
 * <p>The native side already handles position updates separately —
 * coordinate changes flow through the {@code advancedMarkers} prop on
 * the {@code <NativeMapView>}, NOT through this snapshot — so a
 * frozen visual still moves around the map correctly.
 */
const FrozenSnapshot = memo(
  function FrozenSnapshot({
    snapshotId,
    initialChildren,
    onMount,
  }: {
    snapshotId: string;
    initialChildren: React.ReactNode;
    onMount: (id: string, node: View | null) => void;
  }) {
    const [frozenChildren] = useState(() => initialChildren);
    const nodeRef = useRef<View | null>(null);
    return (
      <View
        ref={node => {
          nodeRef.current = node;
          onMount(snapshotId, node);
        }}
        collapsable={false}
        renderToHardwareTextureAndroid
        // Safety net: if the first ref call happened before the
        // children had laid out (size 0×0), native silently skipped
        // the rasterization. Re-emit once the view has a real size
        // so the bitmap is captured for sure. This is a one-way
        // notification — the View itself doesn't re-render.
        onLayout={() => {
          if (nodeRef.current) onMount(snapshotId, nodeRef.current);
        }}
      >
        {frozenChildren}
      </View>
    );
  },
  () => true,
);

// ============================================================================
// Component
// ============================================================================

const MapView = forwardRef<MapViewMethods, MapViewProps>(
  (
    {
      children,
      onPress,
      onLongPress,
      onRegionChange,
      onRegionChangeComplete,
      onMapReady,
      onUserLocationChange,
      customMapStyle,
      clusterConfig,
      initialRegion,
      region,
      mapId,
      ...props
    },
    ref,
  ) => {
    const nativeRef = useRef<React.ElementRef<typeof NativeMapView>>(null);
    const markerViewTags = useRef(new Map<string, number>());
    const advancedMarkerViewTags = useRef(new Map<string, number>());
    const inlineParsed = useMemo(() => parseChildren(children), [children]);
    const resolvedMapId = mapId ?? DEFAULT_MAP_ID;

    // -----------------------------------------------------------------
    // Context-based <AdvancedMarker> registration.
    //
    // The inline JSX pattern <MapView><AdvancedMarker .../></MapView>
    // is handled by parseChildren above. The wrapped pattern
    // <MapView><MyDriverPin /></MapView> (where MyDriverPin renders
    // an AdvancedMarker internally) flows through this registry.
    //
    // Both sources are merged into `parsed` below. Registry entries
    // win on id collision because they have the most up-to-date
    // children reference.
    // -----------------------------------------------------------------
    const [registeredAdvancedMarkers, setRegisteredAdvancedMarkers] =
      useState<Map<string, AdvancedMarkerRegistration>>(() => new Map());

    const mapContextValue = useMemo<MapContextValue>(
      () => ({
        upsertAdvancedMarker(id, entry) {
          setRegisteredAdvancedMarkers(prev => {
            const next = new Map(prev);
            next.set(id, entry);
            return next;
          });
        },
        removeAdvancedMarker(id) {
          setRegisteredAdvancedMarkers(prev => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
        },
      }),
      [],
    );

    /**
     * Merge the inline `parseChildren` result with markers contributed
     * by the registry. The merged shape mirrors `parseChildren`'s so
     * the rest of the component doesn't need to know whether a marker
     * came from inline JSX or from a wrapped component.
     */
    const parsed = useMemo(() => {
      if (registeredAdvancedMarkers.size === 0) return inlineParsed;

      // Clone the per-id collections so we don't mutate parseChildren's
      // output. Shallow clones are sufficient — values are leaf data.
      const advancedMarkers = [...inlineParsed.advancedMarkers];
      const advancedMarkerSnapshots = [...inlineParsed.advancedMarkerSnapshots];
      const advancedMarkerMeta = new Map(inlineParsed.advancedMarkerMeta);
      const markerPressHandlers = new Map(inlineParsed.markerPressHandlers);
      const markerSelectHandlers = new Map(inlineParsed.markerSelectHandlers);
      const markerDeselectHandlers = new Map(inlineParsed.markerDeselectHandlers);
      const markerDragStartHandlers = new Map(
        inlineParsed.markerDragStartHandlers,
      );
      const markerDragHandlers = new Map(inlineParsed.markerDragHandlers);
      const markerDragEndHandlers = new Map(inlineParsed.markerDragEndHandlers);

      const advIdxById = new Map<string, number>();
      advancedMarkers.forEach((m, i) => advIdxById.set(m.id, i));
      const snapIdxById = new Map<string, number>();
      advancedMarkerSnapshots.forEach((s, i) => snapIdxById.set(s.id, i));

      for (const [id, entry] of registeredAdvancedMarkers) {
        const p = entry.props;
        const customChildren = entry.children;
        const hasCustomView =
          customChildren != null &&
          !(Array.isArray(customChildren) && customChildren.length === 0);

        const native: NativeAdvancedMarker = {
          id,
          latitude: p.coordinate.latitude,
          longitude: p.coordinate.longitude,
          title: p.title,
          description: p.description,
          pinColor: p.pinColor,
          draggable: p.draggable,
          flat: p.flat,
          rotation: p.rotation,
          opacity: p.opacity,
          anchor: p.anchor,
          zIndex: p.zIndex,
          hasCustomView,
          tracksViewChanges: p.tracksViewChanges,
        };

        const advIdx = advIdxById.get(id);
        if (advIdx != null) advancedMarkers[advIdx] = native;
        else {
          advIdxById.set(id, advancedMarkers.length);
          advancedMarkers.push(native);
        }

        if (hasCustomView) {
          const snap = { id, children: customChildren };
          const snapIdx = snapIdxById.get(id);
          if (snapIdx != null) advancedMarkerSnapshots[snapIdx] = snap;
          else {
            snapIdxById.set(id, advancedMarkerSnapshots.length);
            advancedMarkerSnapshots.push(snap);
          }
        }

        advancedMarkerMeta.set(id, {
          id,
          coordinate: p.coordinate,
          data: p.data,
          title: p.title,
          isCustom: hasCustomView,
        });

        if (p.onPress) markerPressHandlers.set(id, p.onPress);
        if (p.onSelect) markerSelectHandlers.set(id, p.onSelect);
        if (p.onDeselect) markerDeselectHandlers.set(id, p.onDeselect);
        if (p.onDragStart) markerDragStartHandlers.set(id, p.onDragStart);
        if (p.onDrag) markerDragHandlers.set(id, p.onDrag);
        if (p.onDragEnd) markerDragEndHandlers.set(id, p.onDragEnd);
      }

      return {
        ...inlineParsed,
        advancedMarkers,
        advancedMarkerSnapshots,
        advancedMarkerMeta,
        markerPressHandlers,
        markerSelectHandlers,
        markerDeselectHandlers,
        markerDragStartHandlers,
        markerDragHandlers,
        markerDragEndHandlers,
      };
    }, [inlineParsed, registeredAdvancedMarkers]);


    const getReactTag = useCallback(() => {
      const tag = findNodeHandle(nativeRef.current);
      return tag == null ? -1 : tag;
    }, []);
    const getReactTagSafe = useCallback(() => {
      const tag = getReactTag();
      return tag >= 0 ? tag : null;
    }, [getReactTag]);

    useImperativeHandle(
      ref,
      () => ({
        animateToRegion(r: Region, options?: CameraOptions) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          NativeMapViewManager.animateToRegion(
            tag,
            r,
            options?.duration ?? DEFAULT_DURATION,
          );
        },
        animateToCoordinate(coordinate: Coordinate, duration = DEFAULT_DURATION) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          NativeMapViewManager.animateToCoordinate(tag, coordinate, duration);
        },
        fitToCoordinates(coordinates, options) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          NativeMapViewManager.fitToCoordinates(
            tag,
            coordinates,
            fitOptions(options),
          );
        },
        fitToElements(options) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          NativeMapViewManager.fitToElements(tag, fitOptions(options));
        },
        fitToSuppliedMarkers(markers, options) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          NativeMapViewManager.fitToSuppliedMarkers(
            tag,
            markers,
            fitOptions(options),
          );
        },
        getCamera() {
          return NativeMapViewManager.getCamera(
            getReactTag(),
          ) as Promise<Camera>;
        },
        setCamera(camera: Camera, options?: CameraOptions) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          NativeMapViewManager.setCamera(
            tag,
            camera,
            options?.duration ?? DEFAULT_DURATION,
          );
        },
        getMarkers() {
          return NativeMapViewManager.getMarkers(getReactTag());
        },
        setActive(active: boolean) {
          const tag = getReactTagSafe();
          if (tag == null) return;
          (NativeMapViewManager as any).setActive?.(tag, active);
        },
        forceRedraw() {
          const tag = getReactTagSafe();
          if (tag == null) return;
          (NativeMapViewManager as any).forceRedraw?.(tag);
        },
        __getReactTag: () => getReactTagSafe(),
      }),
      [getReactTag, getReactTagSafe],
    );

    useEffect(() => {
      parsed.markerRefs.forEach((markerRef, markerId) => {
        setMarkerRef(markerRef, {
          showCallout() {
            NativeMapViewManager.showMarkerCallout(getReactTag(), markerId);
          },
          hideCallout() {
            NativeMapViewManager.hideMarkerCallout(getReactTag(), markerId);
          },
          redraw() {
            NativeMapViewManager.redrawMarker(getReactTag(), markerId);
          },
          animateMarkerToCoordinate(coordinate, durationOrOptions) {
            NativeMapViewManager.animateMarkerToCoordinate(
              getReactTag(),
              markerId,
              coordinate,
              markerAnimationOptions(durationOrOptions),
            );
          },
        });
      });
      return () => {
        parsed.markerRefs.forEach(markerRef => setMarkerRef(markerRef, null));
      };
    }, [getReactTag, parsed]);

    // ==================================================================
    // Clustering pipeline (shared by classic + advanced markers)
    // ==================================================================
    const clusteringEnabled =
      clusterConfig?.enabled !== false && !!clusterConfig;
    /**
     * Resolved ignore-marker predicate. Accepts both shapes documented
     * on {@link ClusterConfig.ignoreClusterIds}:
     *
     *  - {@code string[]} → matched against {@code marker.id}.
     *  - {@code (markerInfo) => boolean} → called per marker with
     *    {@code { id, data, title, coordinate }} so the caller can
     *    match on any property (useful when the React {@code key}
     *    drives the marker's identity but doesn't reach the
     *    {@code identifier} prop through wrapper components).
     */
    const ignoreIdsRaw = clusterConfig?.ignoreClusterIds;
    const shouldIgnoreFromCluster = useMemo(() => {
      if (!ignoreIdsRaw)
        return (_: { id: string }) => false;
      if (typeof ignoreIdsRaw === 'function') return ignoreIdsRaw;
      const set = new Set(ignoreIdsRaw);
      return (m: { id: string }) => set.has(m.id);
    }, [ignoreIdsRaw]);
    const clusterRadius = clusterConfig?.radius ?? DEFAULT_CLUSTER_RADIUS;
    const forceJS = clusterConfig?.forceJS ?? false;
    const renderThreshold =
      clusterConfig?.renderThreshold ?? DEFAULT_RENDER_THRESHOLD;
    const dragThreshold =
      clusterConfig?.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
    const debounceMs = clusterConfig?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const zoomStepOnPress =
      clusterConfig?.zoomStepOnPress ?? DEFAULT_ZOOM_STEP_ON_PRESS;
    const customOnPress = clusterConfig?.customOnPress;
    const maxZoomLevel = props.maxZoomLevel ?? DEFAULT_MAX_ZOOM;

    const liveRegionRef = useRef<Region | undefined>(region ?? initialRegion);
    const lastComputedRegionRef = useRef<Region | undefined>(undefined);
    const [regionForCompute, setRegionForCompute] = useState<
      Region | undefined
    >(region ?? initialRegion);
    const [viewport, setViewport] = useState<{ width: number; height: number }>(
      { width: 0, height: 0 },
    );
    const [clusters, setClusters] = useState<Cluster[]>([]);
    const [advancedClusters, setAdvancedClusters] = useState<Cluster[]>([]);
    const clusterCacheRef = useRef<Map<string, Cluster[]>>(new Map());
    const advancedClusterCacheRef = useRef<Map<string, Cluster[]>>(new Map());
    const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const dragGateRef = useRef<DragGate>(
      new DragGate({
        debounceMs,
        gestureSettleMs: Math.max(debounceMs * 2, 150),
      }),
    );
    const [isDragging, setIsDragging] = useState<boolean>(false);

    // Split markers into clusterable / passthrough (per cluster pipeline).
    const { clusterablePoints, passthroughIds } = useMemo(() => {
      if (!clusteringEnabled)
        return { clusterablePoints: [], passthroughIds: new Set<string>() };
      const cpoints: ClusterPoint[] = [];
      const pass = new Set<string>();
      for (const meta of parsed.markerMeta.values()) {
        const info = {
          id: meta.id,
          data: meta.data,
          title: meta.title,
          coordinate: meta.coordinate,
        };
        if (shouldIgnoreFromCluster(info)) {
          pass.add(meta.id);
        } else {
          cpoints.push({
            id: meta.id,
            coordinate: meta.coordinate,
            data: meta.data,
            title: meta.title,
          });
        }
      }
      return { clusterablePoints: cpoints, passthroughIds: pass };
    }, [clusteringEnabled, parsed.markerMeta, shouldIgnoreFromCluster]);

    const {
      advancedClusterablePoints,
      advancedPassthroughIds,
    } = useMemo(() => {
      if (!clusteringEnabled)
        return {
          advancedClusterablePoints: [],
          advancedPassthroughIds: new Set<string>(),
        };
      const cpoints: ClusterPoint[] = [];
      const pass = new Set<string>();
      for (const meta of parsed.advancedMarkerMeta.values()) {
        const info = {
          id: meta.id,
          data: meta.data,
          title: meta.title,
          coordinate: meta.coordinate,
        };
        if (shouldIgnoreFromCluster(info)) {
          pass.add(meta.id);
        } else {
          cpoints.push({
            id: meta.id,
            coordinate: meta.coordinate,
            data: meta.data,
            title: meta.title,
          });
        }
      }
      return {
        advancedClusterablePoints: cpoints,
        advancedPassthroughIds: pass,
      };
    }, [clusteringEnabled, parsed.advancedMarkerMeta, shouldIgnoreFromCluster]);

    useEffect(() => {
      clusterCacheRef.current.clear();
      advancedClusterCacheRef.current.clear();
    }, [
      clusterablePoints,
      advancedClusterablePoints,
      shouldIgnoreFromCluster,
      clusterRadius,
      viewport.width,
      viewport.height,
    ]);

    const recompute = useCallback(async () => {
      if (!clusteringEnabled) return;
      if (!regionForCompute || viewport.width === 0 || viewport.height === 0) {
        return;
      }

      const cacheKey = zoomBucketKey(
        regionForCompute.longitudeDelta,
        renderThreshold,
      );

      // ----- Classic markers ---------------------------------------------
      if (
        clusterablePoints.length === 0 &&
        passthroughIds.size === 0 &&
        clusters.length > 0
      ) {
        setClusters([]);
      } else if (clusterablePoints.length > 0 || passthroughIds.size > 0) {
        const cached = clusterCacheRef.current.get(cacheKey);
        if (cached) {
          setClusters(cached);
        } else {
          let nativeResult: EngineCluster[] | undefined;
          if (
            !forceJS &&
            (Platform.OS === 'android' || Platform.OS === 'ios')
          ) {
            const tag = getReactTagSafe();
            const compute = (NativeMapViewManager as any).computeClusters;
            if (
              tag != null &&
              typeof compute === 'function' &&
              clusterablePoints.length > 0
            ) {
              try {
                const minimal = clusterablePoints.map(p => ({
                  id: p.id,
                  latitude: p.coordinate.latitude,
                  longitude: p.coordinate.longitude,
                }));
                const buckets = await compute(tag, minimal, clusterRadius);
                if (Array.isArray(buckets)) {
                  nativeResult = clusterPoints({
                    points: clusterablePoints,
                    region: regionForCompute,
                    viewport,
                    radius: clusterRadius,
                    nativeBuckets: buckets.map((b: any) => ({
                      bucketId: b.bucketId,
                      markerIds: b.markerIds,
                      coordinate: {
                        latitude: b.latitude,
                        longitude: b.longitude,
                      },
                    })),
                  });
                }
              } catch {
                /* fall through to JS */
              }
            }
          }
          const result =
            nativeResult ??
            clusterPoints({
              points: clusterablePoints,
              region: regionForCompute,
              viewport,
              radius: clusterRadius,
            });
          clusterCacheRef.current.set(cacheKey, result);
          setClusters(result);
        }
      }

      // ----- Advanced markers --------------------------------------------
      if (
        advancedClusterablePoints.length === 0 &&
        advancedPassthroughIds.size === 0 &&
        advancedClusters.length > 0
      ) {
        setAdvancedClusters([]);
      } else if (
        advancedClusterablePoints.length > 0 ||
        advancedPassthroughIds.size > 0
      ) {
        const cached = advancedClusterCacheRef.current.get(cacheKey);
        if (cached) {
          setAdvancedClusters(cached);
        } else {
          const result = clusterPoints({
            points: advancedClusterablePoints,
            region: regionForCompute,
            viewport,
            radius: clusterRadius,
          });
          advancedClusterCacheRef.current.set(cacheKey, result);
          setAdvancedClusters(result);
        }
      }

      lastComputedRegionRef.current = regionForCompute;
    }, [
      clusteringEnabled,
      clusterablePoints,
      passthroughIds.size,
      advancedClusterablePoints,
      advancedPassthroughIds.size,
      regionForCompute,
      viewport,
      clusterRadius,
      forceJS,
      renderThreshold,
      getReactTagSafe,
      clusters.length,
      advancedClusters.length,
    ]);

    useEffect(() => {
      recompute();
    }, [recompute]);

    const runDeferredRecompute = useCallback(() => {
      if (!clusteringEnabled) return;
      const live = liveRegionRef.current;
      if (!live || viewport.width === 0 || viewport.height === 0) return;
      const should = shouldRecompute({
        previousRegion: lastComputedRegionRef.current,
        currentRegion: live,
        viewport,
        renderThreshold,
        dragThreshold,
      });
      if (should) setRegionForCompute(live);
    }, [clusteringEnabled, viewport, renderThreshold, dragThreshold]);

    const dispatchToGate = useCallback(
      (
        kind: 'region-change' | 'region-change-complete',
        isGesture: boolean,
      ) => {
        if (!clusteringEnabled) return;
        const decision = dragGateRef.current.handle({ type: kind, isGesture });
        if (decision.isDragging !== isDragging)
          setIsDragging(decision.isDragging);
        if (decision.shouldRecompute) {
          runDeferredRecompute();
          return;
        }
        if (decision.scheduleSettleCheck > 0) {
          if (recomputeTimerRef.current)
            clearTimeout(recomputeTimerRef.current);
          recomputeTimerRef.current = setTimeout(() => {
            recomputeTimerRef.current = null;
            const idleDecision = dragGateRef.current.handle({
              type: 'idle-timeout',
            });
            if (idleDecision.isDragging !== isDragging) {
              setIsDragging(idleDecision.isDragging);
            }
            if (idleDecision.shouldRecompute) runDeferredRecompute();
          }, decision.scheduleSettleCheck);
        }
      },
      [clusteringEnabled, isDragging, runDeferredRecompute],
    );

    useEffect(() => {
      return () => {
        if (recomputeTimerRef.current) {
          clearTimeout(recomputeTimerRef.current);
          recomputeTimerRef.current = null;
        }
      };
    }, []);

    // ------------------------------------------------------------------
    // Icon prefetching (classic markers only — advanced markers don't
    // need bitmap prefetch because their children render as native views)
    // ------------------------------------------------------------------
    useEffect(() => {
      if (isDragging) return;
      const urls: string[] = [];
      for (const meta of parsed.markerMeta.values()) {
        const uri = meta.imageUri;
        if (!uri) continue;
        if (!/^https?:/i.test(uri)) continue;
        if (defaultIconCache.beginPrefetch(uri)) urls.push(uri);
      }
      if (urls.length === 0) return;
      const tag = getReactTagSafe();
      if (tag == null) return;
      const prefetch = (NativeMapViewManager as any).prefetchMarkerIcons;
      if (typeof prefetch !== 'function') return;
      try {
        prefetch(tag, urls);
        for (const u of urls) defaultIconCache.markLoaded(u);
      } catch {
        for (const u of urls) defaultIconCache.markFailed(u);
      }
    }, [parsed.markerMeta, getReactTagSafe, isDragging]);

    // ------------------------------------------------------------------
    // Cluster press dispatcher
    // ------------------------------------------------------------------
    const expandClusterToMarkers = useCallback(
      (cluster: Cluster) => {
        const tag = getReactTagSafe();
        if (tag == null) return;
        const coords = cluster.markers.map(m => m.coordinate);
        if (coords.length === 0) return;
        NativeMapViewManager.fitToCoordinates(tag, coords, {
          animated: true,
          padding: DEFAULT_CLUSTER_EXPAND_PADDING,
          edgePadding: undefined,
        });
      },
      [getReactTagSafe],
    );

    const defaultZoomIntoCluster = useCallback(
      (cluster: Cluster) => {
        const tag = getReactTagSafe();
        if (tag == null) return;
        const live = liveRegionRef.current;
        if (!live) return;

        const currentZoom = regionToZoom(live.longitudeDelta);
        const requestedZoom = currentZoom + zoomStepOnPress;

        if (cluster.pointCount > 1 && currentZoom >= maxZoomLevel - 1e-3) {
          expandClusterToMarkers(cluster);
          return;
        }

        const targetZoom = Math.min(requestedZoom, maxZoomLevel);
        const newLngDelta = 360 / Math.pow(2, targetZoom);
        const aspect =
          live.longitudeDelta > 0
            ? live.latitudeDelta / live.longitudeDelta
            : 1;

        NativeMapViewManager.animateToRegion(
          tag,
          {
            latitude: cluster.coordinate.latitude,
            longitude: cluster.coordinate.longitude,
            longitudeDelta: newLngDelta,
            latitudeDelta: newLngDelta * aspect,
          },
          DEFAULT_DURATION,
        );

        if (
          cluster.pointCount > 1 &&
          requestedZoom > maxZoomLevel &&
          Math.abs(targetZoom - currentZoom) < 1e-3
        ) {
          expandClusterToMarkers(cluster);
        }
      },
      [getReactTagSafe, zoomStepOnPress, maxZoomLevel, expandClusterToMarkers],
    );

    const handleClusterPress = useCallback(
      (cluster: Cluster, pressHandlers: Map<string, MarkerProps['onPress']>) => {
        clusterConfig?.onClusterPress?.(cluster);
        if (customOnPress) {
          customOnPress(cluster);
          return;
        }
        if (cluster.pointCount === 1) {
          const onlyId = cluster.markerIds[0];
          const handler = pressHandlers.get(onlyId);
          handler?.({ coordinate: cluster.coordinate });
          return;
        }
        defaultZoomIntoCluster(cluster);
      },
      [clusterConfig, customOnPress, defaultZoomIntoCluster],
    );

    // ------------------------------------------------------------------
    // Build native marker lists for classic markers
    // ------------------------------------------------------------------
    const renderClusterFn = clusterConfig?.renderCluster;
    const { nativeMarkers, clusterSnapshots, clusterById } = useMemo(() => {
      if (!clusteringEnabled) {
        return {
          nativeMarkers: parsed.markers,
          clusterSnapshots: [] as MarkerSnapshot[],
          clusterById: new Map<string, Cluster>(),
        };
      }
      const out: NativeMarker[] = [];
      const snaps: MarkerSnapshot[] = [];
      const byId = new Map<string, Cluster>();

      const markerById = new Map<string, NativeMarker>();
      for (const m of parsed.markers) markerById.set(m.id, m);
      const snapshotByMarkerId = new Map<string, MarkerSnapshot>();
      for (const s of parsed.markerSnapshots) snapshotByMarkerId.set(s.id, s);
      const isCustomById = new Map<string, boolean>();
      for (const meta of parsed.markerMeta.values()) {
        isCustomById.set(meta.id, meta.isCustom);
      }

      for (const m of parsed.markers) {
        if (passthroughIds.has(m.id)) out.push(m);
      }

      for (const c of clusters) {
        const resolved = resolveCluster<NativeMarker, MarkerSnapshot>({
          cluster: c,
          markerById,
          snapshotByMarkerId,
          isCustomById,
          makeClusterMarker: cluster => {
            const stableId = stableClusterKey(cluster);
            return {
              id: `${CLUSTER_MARKER_PREFIX}${stableId}`,
              latitude: cluster.coordinate.latitude,
              longitude: cluster.coordinate.longitude,
              tappable: true,
              tracksViewChanges: true,
              anchor: { x: 0.5, y: 0.5 },
            } as NativeMarker;
          },
          makeClusterSnapshot: (cluster, syntheticId) => {
            const node = renderClusterFn ? (
              renderClusterFn(cluster as Cluster)
            ) : (
              <DefaultClusterBubble cluster={cluster as Cluster} />
            );
            return { id: syntheticId, children: node };
          },
        });
        if (!resolved) continue;
        out.push(resolved.marker);
        if (resolved.snapshot) snaps.push(resolved.snapshot);
        if (resolved.isCluster) byId.set(resolved.marker.id, c);
      }
      return { nativeMarkers: out, clusterSnapshots: snaps, clusterById: byId };
    }, [
      clusteringEnabled,
      clusters,
      parsed.markers,
      parsed.markerSnapshots,
      parsed.markerMeta,
      passthroughIds,
      renderClusterFn,
    ]);

    // ------------------------------------------------------------------
    // Build native marker list for ADVANCED markers
    // ------------------------------------------------------------------
    const {
      nativeAdvancedMarkers,
      advancedClusterSnapshots,
      advancedClusterById,
    } = useMemo(() => {
      if (!clusteringEnabled) {
        return {
          nativeAdvancedMarkers: parsed.advancedMarkers,
          advancedClusterSnapshots: [] as MarkerSnapshot[],
          advancedClusterById: new Map<string, Cluster>(),
        };
      }
      const out: NativeAdvancedMarker[] = [];
      const snaps: MarkerSnapshot[] = [];
      const byId = new Map<string, Cluster>();

      const markerById = new Map<string, NativeAdvancedMarker>();
      for (const m of parsed.advancedMarkers) markerById.set(m.id, m);
      const snapshotByMarkerId = new Map<string, MarkerSnapshot>();
      for (const s of parsed.advancedMarkerSnapshots)
        snapshotByMarkerId.set(s.id, s);
      const isCustomById = new Map<string, boolean>();
      for (const meta of parsed.advancedMarkerMeta.values()) {
        isCustomById.set(meta.id, meta.isCustom);
      }

      for (const m of parsed.advancedMarkers) {
        if (advancedPassthroughIds.has(m.id)) out.push(m);
      }

      for (const c of advancedClusters) {
        const resolved = resolveCluster<NativeAdvancedMarker, MarkerSnapshot>({
          cluster: c,
          markerById,
          snapshotByMarkerId,
          isCustomById,
          makeClusterMarker: cluster => {
            const stableId = stableClusterKey(cluster);
            return {
              id: `${ADVANCED_CLUSTER_MARKER_PREFIX}${stableId}`,
              latitude: cluster.coordinate.latitude,
              longitude: cluster.coordinate.longitude,
              hasCustomView: true,
              isCluster: true,
              anchor: { x: 0.5, y: 0.5 },
              // Cluster bubbles are static — route through the GMS-side
              // bitmap path (zero compositor lag, no live pump churn).
              tracksViewChanges: false,
            } as NativeAdvancedMarker;
          },
          makeClusterSnapshot: (cluster, syntheticId) => {
            const node = renderClusterFn ? (
              renderClusterFn(cluster as Cluster)
            ) : (
              <DefaultClusterBubble cluster={cluster as Cluster} />
            );
            return { id: syntheticId, children: node };
          },
        });
        if (!resolved) continue;
        out.push(resolved.marker);
        if (resolved.snapshot) snaps.push(resolved.snapshot);
        if (resolved.isCluster) byId.set(resolved.marker.id, c);
      }
      return {
        nativeAdvancedMarkers: out,
        advancedClusterSnapshots: snaps,
        advancedClusterById: byId,
      };
    }, [
      clusteringEnabled,
      advancedClusters,
      parsed.advancedMarkers,
      parsed.advancedMarkerSnapshots,
      parsed.advancedMarkerMeta,
      advancedPassthroughIds,
      renderClusterFn,
    ]);

    // Snapshots that go into the rasterized snapshot root (classic markers
    // + classic cluster bubbles + advanced cluster bubbles since the
    // synthetic bubble's renderCluster output is a generic React tree).
    const classicSnapshots = useMemo(() => {
      if (!clusteringEnabled) return parsed.markerSnapshots;
      const live = parsed.markerSnapshots.filter(s => passthroughIds.has(s.id));
      return [...live, ...clusterSnapshots];
    }, [
      clusteringEnabled,
      parsed.markerSnapshots,
      clusterSnapshots,
      passthroughIds,
    ]);

    // Snapshots routed to the ADVANCED-marker iconView pipeline. These are
    // the individual <AdvancedMarker> children (kept around for passthrough)
    // plus the synthetic cluster-bubble snapshots — the latter need to ride
    // along on the advanced pipeline so the cluster bubble itself can be an
    // advanced marker.
    const advancedSnapshots = useMemo(() => {
      if (!clusteringEnabled) return parsed.advancedMarkerSnapshots;
      const live = parsed.advancedMarkerSnapshots.filter(s =>
        advancedPassthroughIds.has(s.id),
      );
      return [...live, ...advancedClusterSnapshots];
    }, [
      clusteringEnabled,
      parsed.advancedMarkerSnapshots,
      advancedClusterSnapshots,
      advancedPassthroughIds,
    ]);

    /**
     * Per-marker `tracksViewChanges` lookup. The default is `true` (live
     * overlay path). `false` opts the marker into the GMS-side bitmap
     * path — rendered on the same GL surface as the map tiles, so
     * pan/zoom is perfectly synced with zero compositor lag. Static
     * markers and high-density scenes should use `false`.
     *
     * Cluster bubbles (synthetic ids prefixed with `acluster:`) default
     * to `false` because the bubble itself is static and benefits from
     * the synced bitmap path.
     */
    const advancedTracksChanges = useMemo(() => {
      const map = new Map<string, boolean>();
      for (const m of parsed.advancedMarkers) {
        map.set(m.id, m.tracksViewChanges !== false);
      }
      return map;
    }, [parsed.advancedMarkers]);

    /**
     * Split advanced snapshots into:
     *  - `liveOverlaySnapshots` — rendered as REAL React views in the
     *    absolute overlay layer. Live animations play at native frame
     *    rate. Native projects coord → screen pixels every camera tick.
     *  - `staticBitmapSnapshots` — rendered in an off-screen subtree
     *    and rasterized into a GMS BitmapDescriptor (Android) / UIImage
     *    (iOS) via `setAdvancedMarkerView`. GMS renders the bitmap on
     *    its own GL surface, perfectly synced with the map — zero lag,
     *    zero flicker during pan/zoom.
     *
     * Cluster bubbles always go to the bitmap path (they don't animate
     * and the bitmap path is flicker-free during cluster recomputes).
     */
    const { liveOverlaySnapshots, staticBitmapSnapshots } = useMemo(() => {
      const live: MarkerSnapshot[] = [];
      const stat: MarkerSnapshot[] = [];
      for (const s of advancedSnapshots) {
        // Snapshots not in `advancedTracksChanges` are synthetic cluster
        // bubbles → route to bitmap path (cluster bubbles are not
        // typically animated and bitmap renders flicker-free).
        const tracks = advancedTracksChanges.get(s.id);
        if (tracks === false || tracks === undefined) stat.push(s);
        else live.push(s);
      }
      return { liveOverlaySnapshots: live, staticBitmapSnapshots: stat };
    }, [advancedSnapshots, advancedTracksChanges]);

    // ------------------------------------------------------------------
    // Marker view (snapshot) wiring — classic
    // ------------------------------------------------------------------
    const setMarkerView = useCallback(
      (markerId: string, node: View | null) => {
        if (!node) {
          markerViewTags.current.delete(markerId);
          return;
        }
        const markerViewTag = findNodeHandle(node);
        if (markerViewTag == null) return;
        markerViewTags.current.set(markerId, markerViewTag);
        try {
          NativeMapViewManager.setMarkerView(
            getReactTag(),
            markerId,
            markerViewTag,
          );
        } catch {
          /* race */
        }
      },
      [getReactTag],
    );

    useEffect(() => {
      if (isDragging) return;
      classicSnapshots.forEach(({ id }) => {
        const markerViewTag = markerViewTags.current.get(id);
        if (markerViewTag != null) {
          NativeMapViewManager.setMarkerView(getReactTag(), id, markerViewTag);
        }
      });
    }, [getReactTag, classicSnapshots, nativeMarkers, isDragging]);

    // ------------------------------------------------------------------
    // Marker view wiring — ADVANCED (iconView)
    // ------------------------------------------------------------------
    const setAdvancedMarkerView = useCallback(
      (markerId: string, node: View | null) => {
        const fn = (NativeMapViewManager as any).setAdvancedMarkerView;
        if (!node) {
          advancedMarkerViewTags.current.delete(markerId);
          // Tell native to release its iconView reference BEFORE the
          // underlying view is deallocated by RN — prevents the iOS
          // "view has been unmounted" crash and lets Android detach the
          // live iconView from the GMS overlay container cleanly. -1 is
          // the agreed-upon sentinel for "release".
          if (typeof fn === 'function') {
            try {
              fn(getReactTag(), markerId, -1);
            } catch {
              /* race */
            }
          }
          return;
        }
        const markerViewTag = findNodeHandle(node);
        if (markerViewTag == null) return;
        advancedMarkerViewTags.current.set(markerId, markerViewTag);
        if (typeof fn !== 'function') return;
        try {
          fn(getReactTag(), markerId, markerViewTag);
        } catch {
          /* race */
        }
      },
      [getReactTag],
    );

    useEffect(() => {
      if (isDragging) return;
      const fn = (NativeMapViewManager as any).setAdvancedMarkerView;
      if (typeof fn !== 'function') return;
      staticBitmapSnapshots.forEach(({ id }) => {
        const tagId = advancedMarkerViewTags.current.get(id);
        if (tagId != null) {
          try {
            fn(getReactTag(), id, tagId);
          } catch {
            /* race */
          }
        }
      });
    }, [getReactTag, staticBitmapSnapshots, nativeAdvancedMarkers, isDragging]);

    // ------------------------------------------------------------------
    // Container layout — tracks viewport pixel dimensions
    // ------------------------------------------------------------------
    const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setViewport(prev =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    }, []);

    // ------------------------------------------------------------------
    // Marker press dispatch — routes both classic and advanced clusters
    // ------------------------------------------------------------------
    const handleMarkerPress = useCallback(
      (event: EventPayload<{ id: string; coordinate: Coordinate }>) => {
        const id = event.nativeEvent.id;
        if (clusteringEnabled && id.startsWith(CLUSTER_MARKER_PREFIX)) {
          const cluster = clusterById.get(id);
          if (cluster) handleClusterPress(cluster, parsed.markerPressHandlers);
          return;
        }
        if (
          clusteringEnabled &&
          id.startsWith(ADVANCED_CLUSTER_MARKER_PREFIX)
        ) {
          const cluster = advancedClusterById.get(id);
          if (cluster) handleClusterPress(cluster, parsed.markerPressHandlers);
          return;
        }
        parsed.markerPressHandlers.get(id)?.({
          coordinate: event.nativeEvent.coordinate,
        });
      },
      [
        clusteringEnabled,
        clusterById,
        advancedClusterById,
        handleClusterPress,
        parsed.markerPressHandlers,
      ],
    );

    const handleRegionChange = useCallback(
      (
        event: EventPayload<{ region: Region; details?: RegionChangeDetails }>,
      ) => {
        if (clusteringEnabled) {
          liveRegionRef.current = event.nativeEvent.region;
          dispatchToGate(
            'region-change',
            !!event.nativeEvent.details?.isGesture,
          );
        }
        onRegionChange?.(event.nativeEvent.region, event.nativeEvent.details);
      },
      [clusteringEnabled, onRegionChange, dispatchToGate],
    );
    const handleRegionChangeComplete = useCallback(
      (
        event: EventPayload<{ region: Region; details?: RegionChangeDetails }>,
      ) => {
        if (clusteringEnabled) {
          liveRegionRef.current = event.nativeEvent.region;
          dispatchToGate(
            'region-change-complete',
            !!event.nativeEvent.details?.isGesture,
          );
        }
        onRegionChangeComplete?.(
          event.nativeEvent.region,
          event.nativeEvent.details,
        );
      },
      [clusteringEnabled, onRegionChangeComplete, dispatchToGate],
    );

    /**
     * Pixel-perfect synced overlay registration (Uber/Life360 pattern).
     * The overlay view is mounted as a normal RN child of the
     * `markerOverlayLayer` (no reparenting, no Fabric crash). On mount
     * we tell native its viewTag and lat/lng; native then projects the
     * coord to screen pixels on every camera frame and sets the view's
     * translation directly. The marker stays in perfect sync with the
     * map because the translate-write lands inside the same UI-thread
     * frame as the map's camera composition.
     */
    const overlayViewTags = useRef(new Map<string, number>());
    const setOverlayView = useCallback(
      (
        markerId: string,
        node: View | null,
        latitude: number,
        longitude: number,
      ) => {
        const fn = (NativeMapViewManager as any).setMarkerOverlay;
        if (typeof fn !== 'function') return;
        if (!node) {
          overlayViewTags.current.delete(markerId);
          try {
            fn(getReactTag(), markerId, -1, 0, 0, 0.5, 1);
          } catch {
            /* race */
          }
          return;
        }
        const tag = findNodeHandle(node);
        if (tag == null) return;
        overlayViewTags.current.set(markerId, tag);
        try {
          fn(getReactTag(), markerId, tag, latitude, longitude, 0.5, 1);
        } catch {
          /* race */
        }
      },
      [getReactTag],
    );

    /**
     * Re-emit overlay coordinates whenever the advanced-marker set
     * changes (cluster recompute, live driver lat/lng update). Native
     * re-projects on the next camera frame so the marker stays in sync.
     */
    useEffect(() => {
      const fn = (NativeMapViewManager as any).setMarkerOverlay;
      if (typeof fn !== 'function') return;
      liveOverlaySnapshots.forEach(({ id }) => {
        const tag = overlayViewTags.current.get(id);
        if (tag == null) return;
        const meta = parsed.advancedMarkerMeta.get(id);
        if (!meta) return;
        try {
          fn(
            getReactTag(),
            id,
            tag,
            meta.coordinate.latitude,
            meta.coordinate.longitude,
            0.5,
            1,
          );
        } catch {
          /* race */
        }
      });
    }, [getReactTag, liveOverlaySnapshots, parsed.advancedMarkerMeta]);

    return (
      <MapContext.Provider value={mapContextValue}>
        <View style={styles.container} onLayout={onContainerLayout}>
          {/*
            Invisible host for `children`. Renders the consumer's
            JSX tree so any nested <AdvancedMarker> mounts and can
            register via context. Returns null itself (each
            <AdvancedMarker> returns null), and the children prop is
            ignored on classic Map elements (they're virtual too).
            Wrapping in `position: absolute; width:0; height:0` keeps
            the host inert visually.
          */}
          <View
            collapsable={false}
            pointerEvents="none"
            style={styles.registryHost}
          >
            {children}
          </View>
          <NativeMapView
          ref={nativeRef}
          {...props}
          mapId={resolvedMapId}
          initialRegion={initialRegion}
          region={region}
          markers={nativeMarkers}
          advancedMarkers={nativeAdvancedMarkers as any}
          polylines={parsed.polylines}
          circles={parsed.circles}
          customMapStyle={
            customMapStyle ? JSON.stringify(customMapStyle) : undefined
          }
          onPress={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onPress?.({ coordinate: event.nativeEvent.coordinate })
          }
          onLongPress={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onLongPress?.({ coordinate: event.nativeEvent.coordinate })
          }
          onRegionChange={handleRegionChange}
          onRegionChangeComplete={handleRegionChangeComplete}
          onMapReady={() => onMapReady?.()}
          onUserLocationChange={(
            event: EventPayload<{ coordinate: Coordinate }>,
          ) =>
            onUserLocationChange?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerPress={handleMarkerPress}
          onMarkerSelect={(
            event: EventPayload<{ id: string; coordinate: Coordinate }>,
          ) =>
            parsed.markerSelectHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDeselect={(
            event: EventPayload<{ id: string; coordinate: Coordinate }>,
          ) =>
            parsed.markerDeselectHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDragStart={(
            event: EventPayload<{ id: string; coordinate: Coordinate }>,
          ) =>
            parsed.markerDragStartHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDrag={(
            event: EventPayload<{ id: string; coordinate: Coordinate }>,
          ) =>
            parsed.markerDragHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDragEnd={(
            event: EventPayload<{ id: string; coordinate: Coordinate }>,
          ) =>
            parsed.markerDragEndHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onCalloutPress={(event: EventPayload<{ id: string }>) =>
            parsed.calloutPressHandlers.get(event.nativeEvent.id)?.()
          }
          onPolylinePress={(event: EventPayload<{ id: string }>) =>
            parsed.polylinePressHandlers.get(event.nativeEvent.id)?.()
          }
          collapsable={Platform.OS === 'android' ? false : props.collapsable}
          style={StyleSheet.absoluteFill}
        />

        {/* Classic snapshot root — rasterized into BitmapDescriptor / UIImage */}
        {(Platform.OS === 'android' || Platform.OS === 'ios') &&
        classicSnapshots.length > 0 ? (
          <View pointerEvents="none" style={styles.markerSnapshotRoot}>
            {classicSnapshots.map(snapshot => (
              <View
                key={snapshot.id}
                ref={node => setMarkerView(snapshot.id, node)}
                collapsable={false}
                renderToHardwareTextureAndroid
                onLayout={() => {
                  const tagId = markerViewTags.current.get(snapshot.id);
                  if (tagId != null) {
                    NativeMapViewManager.setMarkerView(
                      getReactTag(),
                      snapshot.id,
                      tagId,
                    );
                  }
                }}
              >
                {snapshot.children}
              </View>
            ))}
          </View>
        ) : null}

        {/*
          Native-synced overlay layer (Uber/Life360 pattern). ONLY
          markers with `tracksViewChanges` left at the default `true`
          land here — those that want live animations (Lottie /
          Animated.View / ActivityIndicator / Reanimated). Native
          re-projects the marker's lat/lng to screen pixels on every
          camera frame and writes view.setTranslationX/Y / view.center
          directly. UIKit/Android's compositor introduces a possible
          ~1 frame lag during very fast pan/zoom — that's the trade-off
          for live native-frame-rate animations.

          For zero-lag, perfectly-synced markers (Uber driver dot,
          static avatar pins), set `tracksViewChanges={false}` on the
          AdvancedMarker — those go to the GMS-side bitmap path below,
          which is rendered on the same GL surface as the map tiles.

          pointerEvents="box-none" — the layer itself doesn't intercept
          touches, but child marker views do (Pressable wraps each).
        */}
        {(Platform.OS === 'android' || Platform.OS === 'ios') &&
        liveOverlaySnapshots.length > 0 ? (
          <View
            pointerEvents="box-none"
            style={StyleSheet.absoluteFill}
            collapsable={false}
          >
            {liveOverlaySnapshots.map(snapshot => {
              const meta = parsed.advancedMarkerMeta.get(snapshot.id);
              if (!meta) return null;
              const onPress = parsed.markerPressHandlers.get(snapshot.id);
              const content = onPress ? (
                <Pressable
                  onPress={() => {
                    onPress({
                      id: snapshot.id,
                      coordinate: meta.coordinate,
                      data: meta.data,
                      title: meta.title,
                    });
                  }}
                >
                  {snapshot.children}
                </Pressable>
              ) : (
                snapshot.children
              );
              return (
                <View
                  key={`adv-${snapshot.id}`}
                  ref={node =>
                    setOverlayView(
                      snapshot.id,
                      node,
                      meta.coordinate.latitude,
                      meta.coordinate.longitude,
                    )
                  }
                  collapsable={false}
                  style={styles.overlayMarker}
                  onLayout={() => {
                    const tag = overlayViewTags.current.get(snapshot.id);
                    const fn = (NativeMapViewManager as any).setMarkerOverlay;
                    if (tag != null && typeof fn === 'function') {
                      try {
                        fn(
                          getReactTag(),
                          snapshot.id,
                          tag,
                          meta.coordinate.latitude,
                          meta.coordinate.longitude,
                          0.5,
                          1,
                        );
                      } catch {
                        /* race */
                      }
                    }
                  }}
                >
                  {content}
                </View>
              );
            })}
          </View>
        ) : null}

        {/*
          Static-bitmap advanced markers — `tracksViewChanges={false}`.
          Each marker's children are FROZEN inside FrozenSnapshot on
          first mount: subsequent registry pushes (which fire whenever
          the parent creates new closures for onPress etc.) are
          silently dropped, so the React subtree never re-renders and
          the native bitmap is rasterized exactly once. Cluster
          bubbles also land here.

          The marker still moves on the map when its coordinate
          changes — coordinate updates flow through the
          `advancedMarkers` prop on `<NativeMapView>`, not through
          this subtree.
        */}
        {(Platform.OS === 'android' || Platform.OS === 'ios') &&
        staticBitmapSnapshots.length > 0 ? (
          <View pointerEvents="none" style={styles.markerSnapshotRoot}>
            {staticBitmapSnapshots.map(snapshot => (
              <FrozenSnapshot
                key={`adv-static-${snapshot.id}`}
                snapshotId={snapshot.id}
                initialChildren={snapshot.children}
                onMount={setAdvancedMarkerView}
              />
            ))}
          </View>
        ) : null}
        </View>
      </MapContext.Provider>
    );
  },
);

MapView.displayName = 'RNCustomMapView';

const styles = StyleSheet.create({
  container: { flex: 1 },
  /**
   * Off-screen host that mounts the consumer's JSX subtree so any
   * descendant `<AdvancedMarker>` can register via context. Zero
   * size, no pointer events, never visible.
   */
  registryHost: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
    opacity: 0,
  },
  markerSnapshotRoot: {
    position: 'absolute',
    left: -10000,
    top: -10000,
    alignItems: 'flex-start',
  },
  /**
   * Each overlay marker sits at the layer's origin with zero size; its
   * actual on-screen position comes from native-side
   * setTranslationX/Y (Android) / .center (iOS) writes applied on every
   * camera frame. Crucially we do NOT set any `transform` here — native
   * needs exclusive write access to that property to keep the marker
   * synced with the map.
   */
  overlayMarker: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});

const defaultClusterStyles = StyleSheet.create({
  bubble: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    backgroundColor: '#1f6feb',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
});

export default MapView;
