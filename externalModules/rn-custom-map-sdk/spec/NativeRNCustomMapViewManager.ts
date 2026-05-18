import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { Double, Int32 } from 'react-native/Libraries/Types/CodegenTypes';

type Coordinate = {
  latitude: Double;
  longitude: Double;
};

type Region = Coordinate & {
  latitudeDelta: Double;
  longitudeDelta: Double;
};

type Camera = {
  center: Coordinate;
  pitch: Double;
  heading: Double;
  zoom: Double;
};

type EdgeInsets = {
  top: Double;
  right: Double;
  bottom: Double;
  left: Double;
};

type FitOptions = {
  animated?: boolean;
  padding?: Double;
  edgePadding?: EdgeInsets;
};

type MarkerAnimationOptions = {
  duration?: Double;
  easing?: string;
  interpolator?: string;
};

type MarkerResponse = {
  id: string;
  coordinate: Coordinate;
  title?: string;
  description?: string;
};

export interface Spec extends TurboModule {
  animateToRegion(reactTag: Int32, region: Region, duration: Int32): void;
  animateToCoordinate(reactTag: Int32, coordinate: Coordinate, duration: Int32): void;
  fitToElements(reactTag: Int32, options?: FitOptions): void;
  fitToSuppliedMarkers(
    reactTag: Int32,
    markerIds: Array<string>,
    options?: FitOptions,
  ): void;
  fitToCoordinates(
    reactTag: Int32,
    coordinates: Array<Coordinate>,
    options?: FitOptions,
  ): void;
  getCamera(reactTag: Int32): Promise<Camera>;
  setCamera(reactTag: Int32, camera: Camera, duration: Int32): void;
  getMarkers(reactTag: Int32): Promise<Array<MarkerResponse>>;
  showMarkerCallout(reactTag: Int32, markerId: string): void;
  hideMarkerCallout(reactTag: Int32, markerId: string): void;
  redrawMarker(reactTag: Int32, markerId: string): void;
  animateMarkerToCoordinate(
    reactTag: Int32,
    markerId: string,
    coordinate: Coordinate,
    options?: MarkerAnimationOptions,
  ): void;
  setMarkerView(reactTag: Int32, markerId: string, markerViewTag: Int32): void;

  // ---- Lifecycle (Issue 2 fix) ----
  // setActive(true) brings the embedded native MapView back to RESUMED state
  // and forces a redraw — call this on tab focus.
  // setActive(false) pauses the native MapView — call this on tab blur to
  // release the GL surface cleanly.
  setActive(reactTag: Int32, active: boolean): void;

  // Forces a layout + GL-surface refresh on the embedded MapView. Used by
  // the useMapTabLifecycle hook to defeat the API 30/33 white-screen bug.
  forceRedraw(reactTag: Int32): void;

  /**
   * Native-accelerated cluster bucketing. Groups the supplied points by
   * pixel-space grid against the current map projection.
   *
   * Returns an array of buckets — only id groupings and the cell center.
   * JS enriches each bucket with marker.data so renderCluster() retains
   * full access to anything the marker carries.
   *
   * The points array must contain only what's needed for projection:
   * { id, latitude, longitude }. Keeping the payload minimal avoids
   * bridge-serialization cost for data that already lives in JS.
   */
  computeClusters(
    reactTag: Int32,
    points: Array<{ id: string; latitude: Double; longitude: Double }>,
    radius: Double,
  ): Promise<
    Array<{
      bucketId: string;
      markerIds: Array<string>;
      latitude: Double;
      longitude: Double;
    }>
  >;
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNCustomMapViewManager');
