import type { HostComponent, ViewProps } from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  BubblingEventHandler,
  DirectEventHandler,
  Double,
  Float,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

type Coordinate = Readonly<{
  latitude: Double;
  longitude: Double;
}>;

type Point = Readonly<{
  x: Double;
  y: Double;
}>;

type Region = Readonly<{
  latitude: Double;
  longitude: Double;
  latitudeDelta: Double;
  longitudeDelta: Double;
}>;

type Camera = Readonly<{
  center: Coordinate;
  pitch: Double;
  heading: Double;
  zoom: Double;
}>;

type NativeMarker = Readonly<{
  id: string;
  latitude: Double;
  longitude: Double;
  title?: WithDefault<string, ''>;
  description?: WithDefault<string, ''>;
  pinColor?: WithDefault<string, ''>;
  image?: WithDefault<string, ''>;
  icon?: WithDefault<string, ''>;
  fallbackColor?: WithDefault<string, ''>;
  fallbackInitial?: WithDefault<string, ''>;
  fallbackRingColor?: WithDefault<string, ''>;
  centerOffset?: Point;
  calloutOffset?: Point;
  anchor?: Point;
  calloutAnchor?: Point;
  draggable?: WithDefault<boolean, false>;
  flat?: WithDefault<boolean, false>;
  rotation?: WithDefault<Float, 0>;
  opacity?: WithDefault<Float, 1>;
  tappable?: WithDefault<boolean, true>;
  tracksViewChanges?: WithDefault<boolean, true>;
  calloutTooltip?: WithDefault<boolean, false>;
}>;

type NativeAdvancedMarker = Readonly<{
  id: string;
  latitude: Double;
  longitude: Double;
  title?: WithDefault<string, ''>;
  description?: WithDefault<string, ''>;
  pinColor?: WithDefault<string, ''>;
  anchor?: Point;
  draggable?: WithDefault<boolean, false>;
  flat?: WithDefault<boolean, false>;
  rotation?: WithDefault<Float, 0>;
  opacity?: WithDefault<Float, 1>;
  zIndex?: WithDefault<Int32, 0>;
  hasCustomView?: WithDefault<boolean, false>;
  isCluster?: WithDefault<boolean, false>;
}>;

type NativePolyline = Readonly<{
  id: string;
  coordinates: ReadonlyArray<Coordinate>;
  strokeColor?: WithDefault<string, '#0000ff'>;
  strokeWidth?: WithDefault<Float, 1>;
  lineDashPattern?: ReadonlyArray<Int32>;
  geodesic?: WithDefault<boolean, false>;
  zIndex?: WithDefault<Int32, 0>;
  tappable?: WithDefault<boolean, false>;
}>;

type NativeCircle = Readonly<{
  id: string;
  center: Coordinate;
  radius: Double;
  strokeColor?: WithDefault<string, '#0000ff'>;
  strokeWidth?: WithDefault<Float, 1>;
  fillColor?: WithDefault<string, 'transparent'>;
  zIndex?: WithDefault<Int32, 0>;
}>;

type CoordinateEvent = Readonly<{
  coordinate: Readonly<{
    latitude: Double;
    longitude: Double;
  }>;
}>;

type RegionEvent = Readonly<{
  region: Readonly<{
    latitude: Double;
    longitude: Double;
    latitudeDelta: Double;
    longitudeDelta: Double;
  }>;
  details?: Readonly<{
    isGesture?: boolean;
  }>;
}>;

type UserLocationEvent = Readonly<{
  coordinate: Readonly<{
    latitude: Double;
    longitude: Double;
  }>;
}>;

type MarkerEvent = Readonly<{
  id: string;
  coordinate: Readonly<{
    latitude: Double;
    longitude: Double;
  }>;
}>;

type OverlayEvent = Readonly<{
  id: string;
}>;

export interface NativeProps extends ViewProps {
  region?: Region;
  initialRegion?: Region;
  camera?: Camera;
  provider?: WithDefault<'google' | 'apple' | 'openstreetmap', 'google'>;
  mapType?: WithDefault<'standard' | 'satellite' | 'hybrid' | 'terrain', 'standard'>;
  customMapStyle?: string;
  showsUserLocation?: WithDefault<boolean, false>;
  zoomEnabled?: WithDefault<boolean, true>;
  scrollEnabled?: WithDefault<boolean, true>;
  rotateEnabled?: WithDefault<boolean, true>;
  pitchEnabled?: WithDefault<boolean, true>;
  minZoomLevel?: Float;
  maxZoomLevel?: Float;
  mapId?: WithDefault<string, 'DEMO_MAP_ID'>;
  markers?: ReadonlyArray<NativeMarker>;
  advancedMarkers?: ReadonlyArray<NativeAdvancedMarker>;
  polylines?: ReadonlyArray<NativePolyline>;
  circles?: ReadonlyArray<NativeCircle>;
  onPress?: BubblingEventHandler<CoordinateEvent>;
  onLongPress?: BubblingEventHandler<CoordinateEvent>;
  onRegionChange?: DirectEventHandler<RegionEvent>;
  onRegionChangeComplete?: DirectEventHandler<RegionEvent>;
  onMapReady?: DirectEventHandler<Readonly<{}>>;
  onUserLocationChange?: DirectEventHandler<UserLocationEvent>;
  onMarkerPress?: BubblingEventHandler<MarkerEvent>;
  onMarkerSelect?: BubblingEventHandler<MarkerEvent>;
  onMarkerDeselect?: BubblingEventHandler<MarkerEvent>;
  onMarkerDragStart?: BubblingEventHandler<MarkerEvent>;
  onMarkerDrag?: BubblingEventHandler<MarkerEvent>;
  onMarkerDragEnd?: BubblingEventHandler<MarkerEvent>;
  onCalloutPress?: BubblingEventHandler<MarkerEvent>;
  onPolylinePress?: BubblingEventHandler<OverlayEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'RNCustomMapView',
) as HostComponent<NativeProps>;
