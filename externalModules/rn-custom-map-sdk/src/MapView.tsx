import React, {
  forwardRef,
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
import Polyline from './Polyline';
import MarkerPlaceholder from './Placeholder';
import { clusterPoints, type Cluster as EngineCluster, type ClusterPoint } from './clustering/cluster';
import {
  shouldRecompute,
  zoomBucketKey,
  regionToZoom,
} from './clustering/throttle';
import { DragGate } from './clustering/dragGate';
import { stableClusterKey } from './clustering/membership';
import { defaultIconCache } from './clustering/iconCache';
import type {
  Camera,
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
const DEFAULT_RENDER_THRESHOLD = 0.5;
const DEFAULT_DRAG_THRESHOLD = 50;
const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_ZOOM_STEP_ON_PRESS = 2;
const DEFAULT_MAX_ZOOM = 20;
const DEFAULT_CLUSTER_EXPAND_PADDING = 80;

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
  /** Cached resolved image URI so we can prefetch without re-resolving. */
  imageUri?: string;
  fallback?: MarkerFallback;
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
    if (child.type === Callout || childTypeName(child) === 'RNCustomMapCallout') {
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

function getMarkerCustomChildren(marker: React.ReactElement<MarkerProps>) {
  const customChildren = React.Children.toArray(marker.props.children).filter(
    child => !isCalloutChild(child),
  );
  return customChildren.length > 0 ? customChildren : null;
}

function parseChildren(children: React.ReactNode) {
  const markers: NativeMarker[] = [];
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
  /** id → {data, title, coordinate} — JS-only, never bridged. */
  const markerMeta = new Map<string, MarkerMeta>();

  React.Children.forEach(children, (child, index) => {
    if (!React.isValidElement(child)) return;
    const name = childTypeName(child);

    if (child.type === Marker || name === 'RNCustomMapMarker') {
      const props = child.props as MarkerProps;
      const id = props.identifier ?? props.id ?? `marker-${index}`;
      const callout = getMarkerCallout(child as React.ReactElement<MarkerProps>);
      const customChildren = getMarkerCustomChildren(child as React.ReactElement<MarkerProps>);
      const markerRef = (child as any).ref ?? (child.props as any).ref;
      const fallback = props.fallback;

      markers.push(compactObject({
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
      }));

      // userData is an alias of data; explicit `data` wins.
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
      });

      if (markerRef) markerRefs.set(id, markerRef);
      if (customChildren) markerSnapshots.push({ id, children: customChildren });
      if (props.onPress) markerPressHandlers.set(id, props.onPress);
      if (props.onSelect) markerSelectHandlers.set(id, props.onSelect);
      if (props.onDeselect) markerDeselectHandlers.set(id, props.onDeselect);
      if (props.onDragStart) markerDragStartHandlers.set(id, props.onDragStart);
      if (props.onDrag) markerDragHandlers.set(id, props.onDrag);
      if (props.onDragEnd) markerDragEndHandlers.set(id, props.onDragEnd);
      if (props.onCalloutPress || callout.onPress) {
        calloutPressHandlers.set(id, (props.onCalloutPress ?? callout.onPress)!);
      }
      return;
    }

    if (child.type === Polyline || name === 'RNCustomMapPolyline') {
      const props = child.props as PolylineProps;
      const id = props.id ?? `polyline-${index}`;
      polylines.push(compactObject({
        id,
        coordinates: props.coordinates,
        strokeColor: props.strokeColor,
        strokeWidth: props.strokeWidth,
        lineDashPattern: props.lineDashPattern,
        geodesic: props.geodesic,
        zIndex: props.zIndex,
        tappable: props.tappable,
      }));
      if (props.onPress) polylinePressHandlers.set(id, props.onPress);
      return;
    }

    if (child.type === Circle || name === 'RNCustomMapCircle') {
      const props = child.props as CircleProps;
      circles.push(compactObject({
        id: props.id ?? `circle-${index}`,
        center: props.center,
        radius: props.radius,
        strokeColor: props.strokeColor,
        strokeWidth: props.strokeWidth,
        fillColor: props.fillColor,
        zIndex: props.zIndex,
      }));
    }
  });

  return {
    markers,
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
    markerMeta,
  };
}

function setMarkerRef(ref: React.Ref<MarkerMethods>, value: MarkerMethods | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref && 'current' in ref) {
    (ref as React.MutableRefObject<MarkerMethods | null>).current = value;
  }
}

function markerAnimationOptions(
  durationOrOptions: number | MarkerAnimationOptions | undefined,
): MarkerAnimationOptions {
  if (typeof durationOrOptions === 'number') return { duration: durationOrOptions };
  return { duration: DEFAULT_DURATION, ...durationOrOptions };
}

function fitOptions(options?: number | { animated?: boolean; padding?: number; edgePadding?: any }) {
  if (typeof options === 'number') {
    return { animated: true, padding: options, edgePadding: undefined };
  }
  return {
    animated: options?.animated ?? true,
    padding: options?.padding ?? DEFAULT_FIT_PADDING,
    edgePadding: options?.edgePadding,
  };
}

/**
 * Default cluster visual used when the consumer didn't provide one. For
 * singleton clusters (count === 1), and when the original marker has a
 * `fallback` config, we render the user-provided MarkerPlaceholder so the
 * first frame is on-brand. For multi-clusters we render a numeric bubble.
 *
 * This is what guarantees no Google pin ever appears — even consumers who
 * forget to set up renderCluster get a styled placeholder.
 */
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
      ...props
    },
    ref,
  ) => {
    const nativeRef = useRef<React.ElementRef<typeof NativeMapView>>(null);
    const markerViewTags = useRef(new Map<string, number>());
    const parsed = useMemo(() => parseChildren(children), [children]);

    // ------------------------------------------------------------------
    // Tag resolution
    // ------------------------------------------------------------------
    const getReactTag = useCallback(() => {
      const tag = findNodeHandle(nativeRef.current);
      // Do NOT throw — first-frame callers may arrive before findNodeHandle
      // resolves. Return -1 so the native side cleanly short-circuits.
      return tag == null ? -1 : tag;
    }, []);
    const getReactTagSafe = useCallback(() => {
      const tag = getReactTag();
      return tag >= 0 ? tag : null;
    }, [getReactTag]);

    // ------------------------------------------------------------------
    // Imperative API
    // ------------------------------------------------------------------
    useImperativeHandle(ref, () => ({
      animateToRegion(r: Region, duration = DEFAULT_DURATION) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.animateToRegion(tag, r, duration);
      },
      animateToCoordinate(coordinate: Coordinate, duration = DEFAULT_DURATION) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.animateToCoordinate(tag, coordinate, duration);
      },
      fitToCoordinates(coordinates, options) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.fitToCoordinates(tag, coordinates, fitOptions(options));
      },
      fitToElements(options) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.fitToElements(tag, fitOptions(options));
      },
      fitToSuppliedMarkers(markers, options) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.fitToSuppliedMarkers(tag, markers, fitOptions(options));
      },
      getCamera() {
        return NativeMapViewManager.getCamera(getReactTag()) as Promise<Camera>;
      },
      setCamera(camera: Camera, duration = DEFAULT_DURATION) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.setCamera(tag, camera, duration);
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
    }), [getReactTag, getReactTagSafe]);

    // ------------------------------------------------------------------
    // Per-marker ref wiring (unchanged)
    // ------------------------------------------------------------------
    useEffect(() => {
      parsed.markerRefs.forEach((markerRef, markerId) => {
        setMarkerRef(markerRef, {
          showCallout() { NativeMapViewManager.showMarkerCallout(getReactTag(), markerId); },
          hideCallout() { NativeMapViewManager.hideMarkerCallout(getReactTag(), markerId); },
          redraw() { NativeMapViewManager.redrawMarker(getReactTag(), markerId); },
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
    // Clustering pipeline
    // ==================================================================

    const clusteringEnabled = clusterConfig?.enabled !== false && !!clusterConfig;
    const ignoreSet = useMemo(
      () => new Set(clusterConfig?.ignoreClusterIds ?? []),
      [clusterConfig?.ignoreClusterIds],
    );
    const clusterRadius = clusterConfig?.radius ?? DEFAULT_CLUSTER_RADIUS;
    const forceJS = clusterConfig?.forceJS ?? false;
    const renderThreshold = clusterConfig?.renderThreshold ?? DEFAULT_RENDER_THRESHOLD;
    const dragThreshold = clusterConfig?.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
    const debounceMs = clusterConfig?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const zoomStepOnPress = clusterConfig?.zoomStepOnPress ?? DEFAULT_ZOOM_STEP_ON_PRESS;
    const customOnPress = clusterConfig?.customOnPress;
    const maxZoomLevel = props.maxZoomLevel ?? DEFAULT_MAX_ZOOM;

    /**
     * Live region — updated on every region-change event (incl. mid-drag). Used
     * only for tracking; never feeds the cluster engine directly.
     */
    const liveRegionRef = useRef<Region | undefined>(region ?? initialRegion);
    /**
     * Last region that was actually fed into the cluster engine. Used as the
     * baseline for the renderThreshold / dragThreshold checks.
     */
    const lastComputedRegionRef = useRef<Region | undefined>(undefined);
    /**
     * Region that the recompute effect is currently computing against. Only
     * advances when thresholds are met or inputs (points/viewport) change.
     */
    const [regionForCompute, setRegionForCompute] = useState<Region | undefined>(
      region ?? initialRegion,
    );
    /** Viewport pixel size — tracked from container onLayout. */
    const [viewport, setViewport] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });
    /** Latest computed clusters. */
    const [clusters, setClusters] = useState<Cluster[]>([]);
    /**
     * Zoom-bucket → cluster-array cache. Lets the user pan & zoom back through
     * previously-computed levels without re-running the algorithm.
     */
    const clusterCacheRef = useRef<Map<string, Cluster[]>>(new Map());
    /** Pending debounce handle for the "settle then recompute" timer. */
    const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * Drag-aware gate. Lives for the lifetime of the MapView. The gate is
     * the SINGLE source of truth for "is the user mid-gesture?", which is
     * the answer that decides whether we run clustering on each event.
     * Without this gate, every region-change during a pinch fires a fresh
     * cluster pass, which in turn re-creates native markers and produces
     * the perceptible default-pin flicker.
     */
    const dragGateRef = useRef<DragGate>(
      new DragGate({ debounceMs, gestureSettleMs: Math.max(debounceMs * 2, 150) }),
    );
    /**
     * Drag state mirrored into React so the render path can suppress
     * non-essential work (snapshot-view reflow, prefetching) while a
     * gesture is in flight.
     */
    const [isDragging, setIsDragging] = useState<boolean>(false);

    /**
     * Splits the marker meta map into "passthrough" (kept as-is, e.g. items
     * the consumer pinned via ignoreClusterIds) and "clusterable" inputs.
     */
    const { clusterablePoints, passthroughIds } = useMemo(() => {
      if (!clusteringEnabled) return { clusterablePoints: [], passthroughIds: new Set<string>() };
      const cpoints: ClusterPoint[] = [];
      const pass = new Set<string>();
      for (const meta of parsed.markerMeta.values()) {
        if (ignoreSet.has(meta.id)) {
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
    }, [clusteringEnabled, parsed.markerMeta, ignoreSet]);

    /**
     * Reset the cluster cache whenever any input that materially affects the
     * cluster output changes. Pan/zoom alone never invalidates the cache.
     */
    useEffect(() => {
      clusterCacheRef.current.clear();
    }, [clusterablePoints, ignoreSet, clusterRadius, viewport.width, viewport.height]);

    /**
     * Run clustering: tries native first (Android/iOS only when supported)
     * and gracefully falls back to the pure-JS engine. Results are written
     * into the bucketed cache keyed by zoom level so that returning to a
     * previously-computed zoom level is free.
     */
    const recompute = useCallback(async () => {
      if (!clusteringEnabled) return;
      if (clusterablePoints.length === 0 && passthroughIds.size === 0) {
        setClusters([]);
        return;
      }
      if (!regionForCompute || viewport.width === 0 || viewport.height === 0) {
        return;
      }

      const cacheKey = zoomBucketKey(regionForCompute.longitudeDelta, renderThreshold);
      const cached = clusterCacheRef.current.get(cacheKey);
      if (cached) {
        setClusters(cached);
        lastComputedRegionRef.current = regionForCompute;
        return;
      }

      // --- Native acceleration path -------------------------------------
      let nativeResult: EngineCluster[] | undefined;
      if (!forceJS && (Platform.OS === 'android' || Platform.OS === 'ios')) {
        const tag = getReactTagSafe();
        const compute = (NativeMapViewManager as any).computeClusters;
        if (tag != null && typeof compute === 'function' && clusterablePoints.length > 0) {
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
                  coordinate: { latitude: b.latitude, longitude: b.longitude },
                })),
              });
            }
          } catch {
            // Fall through to the JS engine below.
          }
        }
      }

      // --- JS fallback / primary path -----------------------------------
      const result = nativeResult ?? clusterPoints({
        points: clusterablePoints,
        region: regionForCompute,
        viewport,
        radius: clusterRadius,
      });
      clusterCacheRef.current.set(cacheKey, result);
      lastComputedRegionRef.current = regionForCompute;
      setClusters(result);
    }, [
      clusteringEnabled,
      clusterablePoints,
      passthroughIds.size,
      regionForCompute,
      viewport,
      clusterRadius,
      forceJS,
      renderThreshold,
      getReactTagSafe,
    ]);

    useEffect(() => {
      recompute();
    }, [recompute]);

    /**
     * Run the deferred recompute path. Reads "live" region (which may have
     * advanced since the gate started waiting) and only commits to the
     * cluster engine when the camera has moved enough to matter.
     */
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

    /**
     * Dispatch a `region-change` event to the drag gate and act on its
     * decision. The renderer never schedules a recompute on its own anymore
     * — it only obeys the gate.
     */
    const dispatchToGate = useCallback(
      (
        kind: 'region-change' | 'region-change-complete',
        isGesture: boolean,
      ) => {
        if (!clusteringEnabled) return;
        const decision = dragGateRef.current.handle({ type: kind, isGesture });
        if (decision.isDragging !== isDragging) setIsDragging(decision.isDragging);
        if (decision.shouldRecompute) {
          // Should never happen for region-change / region-change-complete
          // (gate only emits shouldRecompute on idle-timeout), but obey it
          // defensively in case the gate's API ever changes.
          runDeferredRecompute();
          return;
        }
        if (decision.scheduleSettleCheck > 0) {
          if (recomputeTimerRef.current) clearTimeout(recomputeTimerRef.current);
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

    // Tear down any pending debounce on unmount.
    useEffect(() => {
      return () => {
        if (recomputeTimerRef.current) {
          clearTimeout(recomputeTimerRef.current);
          recomputeTimerRef.current = null;
        }
      };
    }, []);

    // ------------------------------------------------------------------
    // Icon prefetching — warms the native bitmap cache up-front
    // ------------------------------------------------------------------
    /**
     * Collects every remote image URL referenced by the current marker set
     * and asks the native module to warm its bitmap cache. Already-loaded
     * URLs are deduplicated through `defaultIconCache` so the bridge sees
     * only first-time entries. Runs whenever the marker set changes and is
     * intentionally suppressed during drag (prefetching mid-pinch wastes
     * cycles on URLs whose markers may have left the viewport by the time
     * the bitmap lands).
     */
    useEffect(() => {
      if (isDragging) return;
      const urls: string[] = [];
      for (const meta of parsed.markerMeta.values()) {
        const uri = meta.imageUri;
        if (!uri) continue;
        if (!/^https?:/i.test(uri)) continue; // only remote images need warming
        if (defaultIconCache.beginPrefetch(uri)) urls.push(uri);
      }
      if (urls.length === 0) return;
      const tag = getReactTagSafe();
      if (tag == null) return;
      const prefetch = (NativeMapViewManager as any).prefetchMarkerIcons;
      if (typeof prefetch !== 'function') return;
      try {
        prefetch(tag, urls);
        // Optimistic: the native side will resolve / reject on its own.
        // The cache stays in `pending` until we hear back, OR until the
        // 500ms placeholder deadline elapses.
        for (const u of urls) defaultIconCache.markLoaded(u);
      } catch {
        for (const u of urls) defaultIconCache.markFailed(u);
      }
    }, [parsed.markerMeta, getReactTagSafe, isDragging]);

    // ------------------------------------------------------------------
    // Cluster press dispatcher — default zoom-in behavior with overrides
    // ------------------------------------------------------------------
    const expandClusterToMarkers = useCallback((cluster: Cluster) => {
      const tag = getReactTagSafe();
      if (tag == null) return;
      const coords = cluster.markers.map(m => m.coordinate);
      if (coords.length === 0) return;
      NativeMapViewManager.fitToCoordinates(tag, coords, {
        animated: true,
        padding: DEFAULT_CLUSTER_EXPAND_PADDING,
        edgePadding: undefined,
      });
    }, [getReactTagSafe]);

    const defaultZoomIntoCluster = useCallback((cluster: Cluster) => {
      const tag = getReactTagSafe();
      if (tag == null) return;
      const live = liveRegionRef.current;
      if (!live) return;

      const currentZoom = regionToZoom(live.longitudeDelta);
      const requestedZoom = currentZoom + zoomStepOnPress;

      // Already at (or past) maxZoom AND the cluster still has > 1 member?
      // Spread the camera over the members instead of zooming further.
      if (cluster.pointCount > 1 && currentZoom >= maxZoomLevel - 1e-3) {
        expandClusterToMarkers(cluster);
        return;
      }

      const targetZoom = Math.min(requestedZoom, maxZoomLevel);
      const newLngDelta = 360 / Math.pow(2, targetZoom);
      const aspect =
        live.longitudeDelta > 0 ? live.latitudeDelta / live.longitudeDelta : 1;

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

      // If zoom request was capped at maxZoom and we still have multiple
      // markers in this cluster, fall back to spreading them out so the user
      // can actually see them.
      if (
        cluster.pointCount > 1 &&
        requestedZoom > maxZoomLevel &&
        Math.abs(targetZoom - currentZoom) < 1e-3
      ) {
        expandClusterToMarkers(cluster);
      }
    }, [getReactTagSafe, zoomStepOnPress, maxZoomLevel, expandClusterToMarkers]);

    const handleClusterPress = useCallback((cluster: Cluster) => {
      // Fire legacy notification handler first (no-op if absent).
      clusterConfig?.onClusterPress?.(cluster);

      // customOnPress fully overrides default zoom behavior.
      if (customOnPress) {
        customOnPress(cluster);
        return;
      }

      // Singleton clusters: nothing to expand — surface the original marker's
      // onPress handler if one was registered.
      if (cluster.pointCount === 1) {
        const onlyId = cluster.markerIds[0];
        const handler = parsed.markerPressHandlers.get(onlyId);
        handler?.({ coordinate: cluster.coordinate });
        return;
      }

      defaultZoomIntoCluster(cluster);
    }, [clusterConfig, customOnPress, defaultZoomIntoCluster, parsed.markerPressHandlers]);

    // ------------------------------------------------------------------
    // Build the native marker list — clustered or passthrough
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

      // 1) ignored markers pass through verbatim, with their original
      //    native marker entry + any custom snapshot children.
      for (const m of parsed.markers) {
        if (passthroughIds.has(m.id)) out.push(m);
      }

      // 2) cluster results become synthetic markers. We use the membership
      //    signature (NOT the raw grid id) as the suffix, so a cluster that
      //    keeps the same members across recomputes — even when it moves
      //    between adjacent grid cells — retains the same native marker id.
      //    This is the critical knob that lets the native side reuse its
      //    cached BitmapDescriptor / UIImage instead of recreating the
      //    marker (and showing a default pin for a frame).
      for (const c of clusters) {
        const stableId = stableClusterKey(c);
        const id = `${CLUSTER_MARKER_PREFIX}${stableId}`;
        byId.set(id, c);
        out.push({
          id,
          latitude: c.coordinate.latitude,
          longitude: c.coordinate.longitude,
          tappable: true,
          tracksViewChanges: true,
          anchor: { x: 0.5, y: 0.5 },
        } as NativeMarker);
        const node = renderClusterFn
          ? renderClusterFn(c)
          : <DefaultClusterBubble cluster={c} />;
        snaps.push({ id, children: node });
      }
      return { nativeMarkers: out, clusterSnapshots: snaps, clusterById: byId };
    }, [clusteringEnabled, clusters, parsed.markers, passthroughIds, renderClusterFn]);

    // Combine "real" snapshots (only those that survive passthrough) with cluster snapshots.
    const allSnapshots = useMemo(() => {
      if (!clusteringEnabled) return parsed.markerSnapshots;
      const live = parsed.markerSnapshots.filter(s => passthroughIds.has(s.id));
      return [...live, ...clusterSnapshots];
    }, [clusteringEnabled, parsed.markerSnapshots, clusterSnapshots, passthroughIds]);

    // ------------------------------------------------------------------
    // Marker view (snapshot) wiring
    // ------------------------------------------------------------------
    const setMarkerView = useCallback((markerId: string, node: View | null) => {
      if (!node) {
        markerViewTags.current.delete(markerId);
        return;
      }
      const markerViewTag = findNodeHandle(node);
      if (markerViewTag == null) return;
      markerViewTags.current.set(markerId, markerViewTag);
      try {
        NativeMapViewManager.setMarkerView(getReactTag(), markerId, markerViewTag);
      } catch {
        /* see below */
      }
    }, [getReactTag]);

    useEffect(() => {
      allSnapshots.forEach(({ id }) => {
        const markerViewTag = markerViewTags.current.get(id);
        if (markerViewTag != null) {
          NativeMapViewManager.setMarkerView(getReactTag(), id, markerViewTag);
        }
      });
    }, [getReactTag, allSnapshots, nativeMarkers]);

    // ------------------------------------------------------------------
    // Container layout — tracks viewport pixel dimensions
    // ------------------------------------------------------------------
    const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setViewport(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    }, []);

    // ------------------------------------------------------------------
    // Marker press dispatch — routes cluster taps to handleClusterPress
    // ------------------------------------------------------------------
    const handleMarkerPress = useCallback(
      (event: EventPayload<{ id: string; coordinate: Coordinate }>) => {
        const id = event.nativeEvent.id;
        if (clusteringEnabled && id.startsWith(CLUSTER_MARKER_PREFIX)) {
          const cluster = clusterById.get(id);
          if (cluster) handleClusterPress(cluster);
          return;
        }
        parsed.markerPressHandlers.get(id)?.({ coordinate: event.nativeEvent.coordinate });
      },
      [clusteringEnabled, clusterById, handleClusterPress, parsed.markerPressHandlers],
    );

    // ------------------------------------------------------------------
    // Region tracking — feeds into the drag gate. Clustering only ever
    // recomputes via gate-emitted idle-timeout events, NEVER directly off
    // raw region-change-complete, which would re-fire during fling decay.
    // ------------------------------------------------------------------
    const handleRegionChange = useCallback(
      (event: EventPayload<{ region: Region; details?: RegionChangeDetails }>) => {
        if (clusteringEnabled) {
          liveRegionRef.current = event.nativeEvent.region;
          dispatchToGate('region-change', !!event.nativeEvent.details?.isGesture);
        }
        onRegionChange?.(event.nativeEvent.region, event.nativeEvent.details);
      },
      [clusteringEnabled, onRegionChange, dispatchToGate],
    );
    const handleRegionChangeComplete = useCallback(
      (event: EventPayload<{ region: Region; details?: RegionChangeDetails }>) => {
        if (clusteringEnabled) {
          liveRegionRef.current = event.nativeEvent.region;
          dispatchToGate(
            'region-change-complete',
            !!event.nativeEvent.details?.isGesture,
          );
        }
        onRegionChangeComplete?.(event.nativeEvent.region, event.nativeEvent.details);
      },
      [clusteringEnabled, onRegionChangeComplete, dispatchToGate],
    );

    return (
      <View style={styles.container} onLayout={onContainerLayout}>
        <NativeMapView
          ref={nativeRef}
          {...props}
          initialRegion={initialRegion}
          region={region}
          markers={nativeMarkers}
          polylines={parsed.polylines}
          circles={parsed.circles}
          customMapStyle={customMapStyle ? JSON.stringify(customMapStyle) : undefined}
          onPress={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onPress?.({ coordinate: event.nativeEvent.coordinate })
          }
          onLongPress={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onLongPress?.({ coordinate: event.nativeEvent.coordinate })
          }
          onRegionChange={handleRegionChange}
          onRegionChangeComplete={handleRegionChangeComplete}
          onMapReady={() => onMapReady?.()}
          onUserLocationChange={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onUserLocationChange?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerPress={handleMarkerPress}
          onMarkerSelect={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerSelectHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDeselect={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDeselectHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDragStart={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDragStartHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDrag={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDragHandlers.get(event.nativeEvent.id)?.({
              coordinate: event.nativeEvent.coordinate,
            })
          }
          onMarkerDragEnd={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
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
        {(Platform.OS === 'android' || Platform.OS === 'ios') && allSnapshots.length > 0 ? (
          <View pointerEvents="none" style={styles.markerSnapshotRoot}>
            {allSnapshots.map(snapshot => (
              <View
                key={snapshot.id}
                ref={node => setMarkerView(snapshot.id, node)}
                collapsable={false}
                renderToHardwareTextureAndroid
                onLayout={() => {
                  const markerViewTag = markerViewTags.current.get(snapshot.id);
                  if (markerViewTag != null) {
                    NativeMapViewManager.setMarkerView(getReactTag(), snapshot.id, markerViewTag);
                  }
                }}
              >
                {snapshot.children}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  },
);

MapView.displayName = 'RNCustomMapView';

const styles = StyleSheet.create({
  container: { flex: 1 },
  markerSnapshotRoot: {
    position: 'absolute',
    left: -10000,
    top: -10000,
    alignItems: 'flex-start',
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
