import type * as React from 'react';
import type { ImageSourcePropType, ViewProps, ViewStyle } from 'react-native';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type Region = Coordinate & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type Camera = {
  center: Coordinate;
  pitch: number;
  heading: number;
  zoom: number;
};

export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type RegionChangeDetails = {
  isGesture?: boolean;
};

export type MarkerAnimationOptions = {
  duration?: number;
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  interpolator?:
    | 'linear'
    | 'accelerate'
    | 'decelerate'
    | 'accelerateDecelerate';
};

export type FitToElementsOptions = {
  animated?: boolean;
  padding?: number;
  edgePadding?: EdgeInsets;
};

export type FitToSuppliedMarkersOptions = FitToElementsOptions;

export type MarkerResponse = {
  id: string;
  coordinate: Coordinate;
  title?: string;
  description?: string;
};

export type Point = {
  x: number;
  y: number;
};

export type MapType = 'standard' | 'satellite' | 'hybrid' | 'terrain';
export type MapProvider = 'google' | 'apple' | 'openstreetmap';

export type MapEvent<T> = {
  nativeEvent: T;
};

export interface MapViewProps extends Omit<ViewProps, 'children'> {
  style?: ViewStyle;
  children?: React.ReactNode;
  region?: Region;
  initialRegion?: Region;
  camera?: Camera;
  mapType?: MapType;
  provider?: MapProvider;
  customMapStyle?: any[];
  showsUserLocation?: boolean;
  zoomEnabled?: boolean;
  scrollEnabled?: boolean;
  rotateEnabled?: boolean;
  pitchEnabled?: boolean;
  minZoomLevel?: number;
  maxZoomLevel?: number;
  /**
   * Google Maps Cloud-based styling / Advanced Markers `mapId`.
   *
   * <p>REQUIRED for `<AdvancedMarker>` to render — Google's Advanced Markers
   * APIs only activate on a map created with a valid `mapId`. The SDK ships
   * with the special development value `"DEMO_MAP_ID"` so apps can experiment
   * without provisioning a real ID; production builds should set their own.
   *
   * <p>Has NO effect on classic `<Marker>`. Changing the value at runtime
   * is supported but may force the native map to recreate its GL surface.
   *
   * <p>Default: `"DEMO_MAP_ID"`.
   */
  mapId?: string;
  /**
   * Enables marker clustering. When `enabled` is true (default if the object
   * is present), markers are grouped on every camera idle. See
   * {@link ClusterConfig}.
   */
  clusterConfig?: ClusterConfig;
  onPress?: (event: { coordinate: Coordinate }) => void;
  onLongPress?: (event: { coordinate: Coordinate }) => void;
  onRegionChange?: (region: Region, details?: RegionChangeDetails) => void;
  onRegionChangeComplete?: (
    region: Region,
    details?: RegionChangeDetails,
  ) => void;
  onMapReady?: () => void;
  onUserLocationChange?: (event: { coordinate: Coordinate }) => void;
}

/**
 * A cluster of markers produced by the clustering engine. Singleton clusters
 * (pointCount === 1) are emitted for markers that did not merge with anyone
 * — including markers whose id is in `clusterConfig.ignoreClusterIds`.
 */
export type Cluster = {
  id: string;
  coordinate: Coordinate;
  pointCount: number;
  markerIds: string[];
  markers: Array<{
    id: string;
    coordinate: Coordinate;
    data?: any;
    title?: string;
  }>;
};

export type ClusterConfig = {
  /** Master switch. Defaults to true when the object is supplied. */
  enabled?: boolean;
  /**
   * Marker ids that should never be folded into a cluster. They pass through
   * as ordinary markers regardless of zoom.
   *
   * Can be either:
   * - A list of marker ids (matched against {@code identifier} prop).
   * - A predicate {@code (markerInfo) => boolean} that receives
   *   {@code { id, data, title, coordinate }} per marker — useful when
   *   the marker is rendered through a wrapper component that doesn't
   *   forward the React {@code key} as an {@code identifier} (e.g.,
   *   the "user-location" marker pattern where the host knows the
   *   marker by a property on {@code data}, not by id).
   */
  ignoreClusterIds?:
    | ReadonlyArray<string>
    | ((marker: {
        id: string;
        data?: any;
        title?: string;
        coordinate: Coordinate;
      }) => boolean);
  /** Cluster radius in screen pixels. Default 60. */
  radius?: number;
  /**
   * Renders the visual for a cluster (any pointCount, including 1). Return
   * a React node; it will be snapshotted into the native marker pipeline.
   * When omitted, a default bubble with the point count is rendered.
   */
  renderCluster?: (cluster: Cluster) => React.ReactNode;
  /** Fires when the user taps a cluster (including singletons). */
  onClusterPress?: (cluster: Cluster) => void;
  /**
   * Force the JS path even when native acceleration is available. Useful
   * for debugging or to keep behavior identical across platforms.
   * Defaults to false.
   */
  forceJS?: boolean;
  /**
   * Minimum change in zoom level (Web-Mercator scale, log2(360 / lngDelta))
   * required before clusters are recomputed. Keeps the bubble layer stable
   * during small pinches. Default 0.5.
   */
  renderThreshold?: number;
  /**
   * Minimum on-screen pixel distance the map must be panned before clusters
   * are recomputed. Prevents thrashing while the user is mid-drag. Default 50.
   */
  dragThreshold?: number;
  /**
   * Delay in milliseconds after the camera stops moving before the cluster
   * recomputation runs. Default 100.
   */
  debounceMs?: number;
  /**
   * How many zoom levels the default cluster-press handler should advance.
   * Ignored when `customOnPress` is supplied. Default 2.
   */
  zoomStepOnPress?: number;
  /**
   * Overrides the default cluster-press behavior. When supplied, it is the
   * only handler invoked on tap — the SDK will NOT auto-zoom or expand the
   * cluster. Use it when you want full control (e.g. open a bottom sheet).
   */
  customOnPress?: (cluster: Cluster) => void;
};

/**
 * Visual fallback shown while a marker's custom image is still loading,
 * or when it fails to load. Used by {@link MarkerPlaceholder} and the
 * native side's synthesized fallback bitmap. The platform-default pin is
 * NEVER displayed — `MarkerFallback` is what the user sees instead.
 */
export type MarkerFallback = {
  /** Solid color of the placeholder disc. Default: '#1f6feb' (brand blue). */
  color?: string;
  /** Ring (border) color of the disc. Default: white. */
  ringColor?: string;
  /**
   * Optional one-character initial drawn on top of the disc (the first
   * Unicode code point is used; longer strings are truncated).
   */
  initial?: string;
};

export interface MarkerProps {
  id?: string;
  identifier?: string;
  coordinate: Coordinate;
  title?: string;
  description?: string;
  pinColor?: string;
  image?: ImageSourcePropType;
  icon?: ImageSourcePropType;
  /**
   * Visual fallback shown until the custom image is loaded into the native
   * bitmap cache, OR if the image fails to load. The SDK never displays
   * the platform-default pin: this fallback is the guaranteed first frame.
   */
  fallback?: MarkerFallback;
  centerOffset?: Point;
  calloutOffset?: Point;
  anchor?: Point;
  calloutAnchor?: Point;
  draggable?: boolean;
  flat?: boolean;
  rotation?: number;
  opacity?: number;
  tappable?: boolean;
  tracksViewChanges?: boolean;
  /**
   * Arbitrary payload carried with the marker. Available on every cluster
   * member as `cluster.markers[i].data` — use it to surface images, names,
   * counts, anything else you need inside renderCluster().
   *
   * Stored in JS only. Never bridged to native (no serialization cost,
   * no shape restriction).
   */
  data?: any;
  /** Alias of {@link data} for parity with libraries that use this name. */
  userData?: any;
  children?: React.ReactNode;
  onPress?: (event?: { coordinate: Coordinate }) => void;
  onSelect?: (event?: { coordinate: Coordinate }) => void;
  onDeselect?: (event?: { coordinate: Coordinate }) => void;
  onCalloutPress?: () => void;
  onDragStart?: (event: { coordinate: Coordinate }) => void;
  onDrag?: (event: { coordinate: Coordinate }) => void;
  onDragEnd?: (event: { coordinate: Coordinate }) => void;
}

export interface MarkerMethods {
  showCallout(): void;
  hideCallout(): void;
  redraw(): void;
  animateMarkerToCoordinate(
    coordinate: Coordinate,
    durationOrOptions?: number | MarkerAnimationOptions,
  ): void;
}

export interface CalloutProps {
  tooltip?: boolean;
  children?: React.ReactNode;
  onPress?: () => void;
}

export interface PolylineProps {
  id?: string;
  coordinates: Coordinate[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
  geodesic?: boolean;
  zIndex?: number;
  tappable?: boolean;
  onPress?: () => void;
}

export interface CircleProps {
  id?: string;
  center: Coordinate;
  radius: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  zIndex?: number;
}

export interface CameraOptions {
  duration?: number;
  // easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

export interface MapViewMethods {
  animateToRegion(region: Region, options?: CameraOptions): void;
  animateToCoordinate(coordinate: Coordinate, duration?: number): void;
  fitToCoordinates(
    coordinates: Coordinate[],
    options?: number | FitToElementsOptions,
  ): void;
  fitToElements(options?: number | FitToElementsOptions): void;
  fitToSuppliedMarkers(
    markers: string[],
    options?: number | FitToSuppliedMarkersOptions,
  ): void;
  getCamera(): Promise<Camera>;
  setCamera(camera: Camera, options?: CameraOptions): void;
  getMarkers(): Promise<MarkerResponse[]>;
  /**
   * Bring the embedded Android MapView to RESUMED / PAUSED state.
   * Mainly used by {@link useMapTabLifecycle}. No-op on iOS.
   */
  setActive(active: boolean): void;
  /**
   * Force a layout + GL-surface refresh. Used to defeat the white-screen
   * bug on Android API 30/33 after a tab refocus. No-op on iOS.
   */
  forceRedraw(): void;
  /** @internal */
  __getReactTag?: () => number | null;
}

export type NativeMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
  pinColor?: string;
  image?: string;
  icon?: string;
  /** Hex color of the fallback disc bitmap drawn before the icon loads. */
  fallbackColor?: string;
  /** One-character initial drawn over the fallback disc, if any. */
  fallbackInitial?: string;
  /** Hex color of the disc's outer ring. Default white. */
  fallbackRingColor?: string;
  centerOffset?: Point;
  calloutOffset?: Point;
  anchor?: Point;
  calloutAnchor?: Point;
  draggable?: boolean;
  flat?: boolean;
  rotation?: number;
  opacity?: number;
  tappable?: boolean;
  tracksViewChanges?: boolean;
  calloutTooltip?: boolean;
};

export type NativePolyline = {
  id: string;
  coordinates: Coordinate[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
  geodesic?: boolean;
  zIndex?: number;
  tappable?: boolean;
};

export type NativeCircle = {
  id: string;
  center: Coordinate;
  radius: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  zIndex?: number;
};

// ============================================================================
// AdvancedMarker
// ============================================================================

/**
 * Props accepted by the new `<AdvancedMarker>` component. Mirrors the subset
 * of fields supported by Google Maps Advanced Markers (Android Maps SDK
 * `AdvancedMarkerOptions` and iOS `GMSAdvancedMarker`).
 *
 * Two modes:
 *   - With `children`  → custom marker; children are attached as the native
 *                        iconView so React Native views (Image, Lottie, etc.)
 *                        render directly without a bitmap snapshot.
 *   - Without children → default Google Maps pin, optionally colored via
 *                        `pinColor`.
 */
export interface AdvancedMarkerProps {
  /** Marker position. */
  coordinate: Coordinate;
  /** Unique id used for clustering, refs, and event routing. Required. */
  identifier: string;
  /** Info-window title shown on tap. */
  title?: string;
  /** Info-window description shown on tap. */
  description?: string;
  /** Pin color for the default (no-children) advanced marker. */
  pinColor?: string;
  /** Whether the marker can be dragged by the user. */
  draggable?: boolean;
  /** When true, the marker is drawn flat against the map plane. */
  flat?: boolean;
  /** Rotation in degrees (clockwise around the anchor). */
  rotation?: number;
  /** Opacity (0-1). */
  opacity?: number;
  /** Anchor point on the marker image — (0.5, 1) is the bottom-center. */
  anchor?: Point;
  /** Z-axis stacking order against other markers. */
  zIndex?: number;
  /**
   * Whether the marker should track changes to its `iconView` content
   * frame-by-frame. When true (default), the React children are attached
   * as a live native iconView so animations (Animated.View, Lottie,
   * ActivityIndicator, Reanimated etc.) play back in real time — the
   * same pattern Uber/Lyft/Life360 use for live driver pins.
   *
   * Set to `false` to fall back to the cached static-bitmap path. This
   * is the highest-performance option for dense maps (500+ markers); the
   * children are rasterized once when they first mount and the resulting
   * texture is reused for every camera frame.
   *
   * Default: `true`.
   */
  tracksViewChanges?: boolean;
  /**
   * Arbitrary payload carried with the marker. Surfaced on every cluster
   * member as `cluster.markers[i].data` — same convention used by `<Marker>`.
   * Stored in JS only; never bridged.
   */
  data?: any;
  /**
   * React children for custom marker content. When supplied, the marker
   * renders this tree as the native iconView. When absent, the marker
   * shows the standard Google Maps pin (honoring `pinColor`).
   */
  children?: React.ReactNode;
  /** Fired when the marker (or singleton cluster wrapping it) is tapped. */
  onPress?: (event?: { coordinate: Coordinate }) => void;
  /** Fired when this advanced marker becomes selected. */
  onSelect?: (event?: { coordinate: Coordinate }) => void;
  /** Fired when this advanced marker loses selection. */
  onDeselect?: (event?: { coordinate: Coordinate }) => void;
  /** Fired when a drag gesture begins. Only relevant when `draggable` is true. */
  onDragStart?: (event: { coordinate: Coordinate }) => void;
  /** Fired continuously during a drag. */
  onDrag?: (event: { coordinate: Coordinate }) => void;
  /** Fired when the drag gesture completes. */
  onDragEnd?: (event: { coordinate: Coordinate }) => void;
}

/**
 * Imperative methods exposed on an `<AdvancedMarker>` ref. Currently mirrors
 * the basic `<Marker>` API for parity — the advanced marker pipeline routes
 * the same calls through its dedicated native path.
 */
export interface AdvancedMarkerMethods {
  showCallout(): void;
  hideCallout(): void;
  redraw(): void;
}

/**
 * The shape of the entry pushed across the bridge for each AdvancedMarker.
 * Separated from {@link NativeMarker} so the native side can pick the
 * correct primitive (AdvancedMarkerOptions / GMSAdvancedMarker) without
 * inspecting props on a unified payload.
 */
export type NativeAdvancedMarker = {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
  pinColor?: string;
  draggable?: boolean;
  flat?: boolean;
  rotation?: number;
  opacity?: number;
  anchor?: Point;
  zIndex?: number;
  /**
   * True when the original `<AdvancedMarker>` carried children. The native
   * side uses this hint to expect a follow-up `setAdvancedMarkerView` call
   * for this id, and to suppress the default pin in the meantime.
   */
  hasCustomView?: boolean;
  /**
   * True when this entry was synthesized by the cluster pipeline (i.e. a
   * multi-member cluster bubble). The native side keeps these out of the
   * cluster manager itself.
   */
  isCluster?: boolean;
  /**
   * When true (default), the native side attaches the React children as
   * a live iconView so animations play back in real time. When false,
   * the children are rasterized once and reused as a static bitmap for
   * maximum FPS at scale.
   */
  tracksViewChanges?: boolean;
};
