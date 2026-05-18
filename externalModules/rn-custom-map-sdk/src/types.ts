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
  interpolator?: 'linear' | 'accelerate' | 'decelerate' | 'accelerateDecelerate';
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
   * Enables marker clustering. When `enabled` is true (default if the object
   * is present), markers are grouped on every camera idle. See
   * {@link ClusterConfig}.
   */
  clusterConfig?: ClusterConfig;
  onPress?: (event: { coordinate: Coordinate }) => void;
  onLongPress?: (event: { coordinate: Coordinate }) => void;
  onRegionChange?: (region: Region, details?: RegionChangeDetails) => void;
  onRegionChangeComplete?: (region: Region, details?: RegionChangeDetails) => void;
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
   */
  ignoreClusterIds?: ReadonlyArray<string>;
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

export interface MapViewMethods {
  animateToRegion(region: Region, duration?: number): void;
  animateToCoordinate(coordinate: Coordinate, duration?: number): void;
  fitToCoordinates(
    coordinates: Coordinate[],
    options?: number | FitToElementsOptions,
  ): void;
  fitToElements(options?: number | FitToElementsOptions): void;
  fitToSuppliedMarkers(markers: string[], options?: number | FitToSuppliedMarkersOptions): void;
  getCamera(): Promise<Camera>;
  setCamera(camera: Camera, duration?: number): void;
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
