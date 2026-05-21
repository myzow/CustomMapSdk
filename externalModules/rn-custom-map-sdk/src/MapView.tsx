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

  React.Children.forEach(children, (child, index) => {
    if (!React.isValidElement(child)) return;

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
    }
  });

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
    const parsed = useMemo(() => parseChildren(children), [children]);
    const resolvedMapId = mapId ?? DEFAULT_MAP_ID;

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
    const ignoreSet = useMemo(
      () => new Set(clusterConfig?.ignoreClusterIds ?? []),
      [clusterConfig?.ignoreClusterIds],
    );
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
      return {
        advancedClusterablePoints: cpoints,
        advancedPassthroughIds: pass,
      };
    }, [clusteringEnabled, parsed.advancedMarkerMeta, ignoreSet]);

    useEffect(() => {
      clusterCacheRef.current.clear();
      advancedClusterCacheRef.current.clear();
    }, [
      clusterablePoints,
      advancedClusterablePoints,
      ignoreSet,
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
        if (!node) {
          advancedMarkerViewTags.current.delete(markerId);
          return;
        }
        const markerViewTag = findNodeHandle(node);
        if (markerViewTag == null) return;
        advancedMarkerViewTags.current.set(markerId, markerViewTag);
        const fn = (NativeMapViewManager as any).setAdvancedMarkerView;
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
      advancedSnapshots.forEach(({ id }) => {
        const tagId = advancedMarkerViewTags.current.get(id);
        if (tagId != null) {
          try {
            fn(getReactTag(), id, tagId);
          } catch {
            /* race */
          }
        }
      });
    }, [getReactTag, advancedSnapshots, nativeAdvancedMarkers, isDragging]);

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

    return (
      <View style={styles.container} onLayout={onContainerLayout}>
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

        {/* Advanced snapshot root — attached as native iconView (no raster) */}
        {(Platform.OS === 'android' || Platform.OS === 'ios') &&
        advancedSnapshots.length > 0 ? (
          <View pointerEvents="none" style={styles.markerSnapshotRoot}>
            {advancedSnapshots.map(snapshot => (
              <View
                key={`adv-${snapshot.id}`}
                ref={node => setAdvancedMarkerView(snapshot.id, node)}
                collapsable={false}
                onLayout={() => {
                  const tagId = advancedMarkerViewTags.current.get(snapshot.id);
                  const fn = (NativeMapViewManager as any).setAdvancedMarkerView;
                  if (tagId != null && typeof fn === 'function') {
                    try {
                      fn(getReactTag(), snapshot.id, tagId);
                    } catch {
                      /* race */
                    }
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
