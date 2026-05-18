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
  onPress?: (event: { coordinate: Coordinate }) => void;
  onLongPress?: (event: { coordinate: Coordinate }) => void;
  onRegionChange?: (region: Region, details?: RegionChangeDetails) => void;
  onRegionChangeComplete?: (region: Region, details?: RegionChangeDetails) => void;
  onMapReady?: () => void;
  onUserLocationChange?: (event: { coordinate: Coordinate }) => void;
}

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
