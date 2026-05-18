import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  findNodeHandle,
  Image,
  Platform,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import NativeMapView from '../spec/RNCustomMapViewNativeComponent';
import NativeMapViewManager from '../spec/NativeRNCustomMapViewManager';
import Callout from './Callout';
import Circle from './Circle';
import Marker from './Marker';
import Polyline from './Polyline';
import type {
  Camera,
  CircleProps,
  Coordinate,
  MapViewMethods,
  MapViewProps,
  MarkerAnimationOptions,
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

type EventPayload<T> = NativeSyntheticEvent<T>;

type MarkerSnapshot = {
  id: string;
  children: React.ReactNode;
};

function childTypeName(child: React.ReactElement) {
  const type = child.type as any;
  return type?.displayName || type?.name;
}

function resolveImageSource(source: MarkerProps['image']): string | undefined {
  if (!source) {
    return undefined;
  }
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
    if (!React.isValidElement(child)) {
      return;
    }
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

  React.Children.forEach(children, (child, index) => {
    if (!React.isValidElement(child)) {
      return;
    }

    const name = childTypeName(child);

    if (child.type === Marker || name === 'RNCustomMapMarker') {
      const props = child.props as MarkerProps;
      const id = props.identifier ?? props.id ?? `marker-${index}`;
      const callout = getMarkerCallout(child as React.ReactElement<MarkerProps>);
      const customChildren = getMarkerCustomChildren(child as React.ReactElement<MarkerProps>);
      const markerRef = (child as any).ref ?? (child.props as any).ref;

      markers.push(compactObject({
        id,
        latitude: props.coordinate.latitude,
        longitude: props.coordinate.longitude,
        title: props.title,
        description: props.description,
        pinColor: props.pinColor,
        image: resolveImageSource(props.image),
        icon: resolveImageSource(props.icon),
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

      if (markerRef) {
        markerRefs.set(id, markerRef);
      }
      if (customChildren) {
        markerSnapshots.push({ id, children: customChildren });
      }
      if (props.onPress) {
        markerPressHandlers.set(id, props.onPress);
      }
      if (props.onSelect) {
        markerSelectHandlers.set(id, props.onSelect);
      }
      if (props.onDeselect) {
        markerDeselectHandlers.set(id, props.onDeselect);
      }
      if (props.onDragStart) {
        markerDragStartHandlers.set(id, props.onDragStart);
      }
      if (props.onDrag) {
        markerDragHandlers.set(id, props.onDrag);
      }
      if (props.onDragEnd) {
        markerDragEndHandlers.set(id, props.onDragEnd);
      }
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
      if (props.onPress) {
        polylinePressHandlers.set(id, props.onPress);
      }
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
  };
}

function setMarkerRef(ref: React.Ref<MarkerMethods>, value: MarkerMethods | null) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref && 'current' in ref) {
    (ref as React.MutableRefObject<MarkerMethods | null>).current = value;
  }
}

function markerAnimationOptions(
  durationOrOptions: number | MarkerAnimationOptions | undefined,
): MarkerAnimationOptions {
  if (typeof durationOrOptions === 'number') {
    return { duration: durationOrOptions };
  }
  return { duration: DEFAULT_DURATION, ...durationOrOptions };
}

function fitOptions(options?: number | { animated?: boolean; padding?: number; edgePadding?: any }) {
  if (typeof options === 'number') {
    return {
      animated: true,
      padding: options,
      edgePadding: undefined,
    };
  }
  return {
    animated: options?.animated ?? true,
    padding: options?.padding ?? DEFAULT_FIT_PADDING,
    edgePadding: options?.edgePadding,
  };
}

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
      ...props
    },
    ref,
  ) => {
    const nativeRef = useRef<React.ElementRef<typeof NativeMapView>>(null);
    const markerViewTags = useRef(new Map<string, number>());
    const parsed = useMemo(() => parseChildren(children), [children]);

    const getReactTag = useCallback(() => {
      const tag = findNodeHandle(nativeRef.current);
      if (tag == null) {
        // Do NOT throw — edge-indicator callbacks frequently fire on the
        // very first frame before findNodeHandle resolves. Returning -1
        // lets the native module's resolveMap() short-circuit cleanly and
        // log a warning instead of crashing the JS thread.
        return -1;
      }
      return tag;
    }, []);

    const getReactTagSafe = useCallback(() => {
      const tag = getReactTag();
      return tag >= 0 ? tag : null;
    }, [getReactTag]);

    useImperativeHandle(ref, () => ({
      animateToRegion(region: Region, duration = DEFAULT_DURATION) {
        const tag = getReactTagSafe();
        if (tag == null) return;
        NativeMapViewManager.animateToRegion(tag, region, duration);
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
      // Lifecycle commands — used by useMapTabLifecycle hook (Android only,
      // but the JS surface is platform-agnostic so the hook is portable).
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
      // Private: lets useMapTabLifecycle resolve the tag without re-traversing
      // findNodeHandle on every focus change.
      __getReactTag: () => getReactTagSafe(),
    }), [getReactTag, getReactTagSafe]);

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

    const setMarkerView = useCallback((markerId: string, node: View | null) => {
      if (!node) {
        markerViewTags.current.delete(markerId);
        return;
      }
      const markerViewTag = findNodeHandle(node);
      if (markerViewTag == null) {
        return;
      }
      markerViewTags.current.set(markerId, markerViewTag);
      try {
        NativeMapViewManager.setMarkerView(getReactTag(), markerId, markerViewTag);
      } catch {
        // The map ref can be a frame behind the marker snapshot view during initial mount.
      }
    }, [getReactTag]);

    useEffect(() => {
      parsed.markerSnapshots.forEach(({ id }) => {
        const markerViewTag = markerViewTags.current.get(id);
        if (markerViewTag != null) {
          NativeMapViewManager.setMarkerView(getReactTag(), id, markerViewTag);
        }
      });
    }, [getReactTag, parsed.markerSnapshots, parsed.markers]);

    return (
      <>
        <NativeMapView
          ref={nativeRef}
          {...props}
          markers={parsed.markers}
          polylines={parsed.polylines}
          circles={parsed.circles}
          customMapStyle={customMapStyle ? JSON.stringify(customMapStyle) : undefined}
          onPress={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onPress?.({ coordinate: event.nativeEvent.coordinate })
          }
          onLongPress={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onLongPress?.({ coordinate: event.nativeEvent.coordinate })
          }
          onRegionChange={(event: EventPayload<{ region: Region; details?: RegionChangeDetails }>) =>
            onRegionChange?.(event.nativeEvent.region, event.nativeEvent.details)
          }
          onRegionChangeComplete={(event: EventPayload<{ region: Region; details?: RegionChangeDetails }>) =>
            onRegionChangeComplete?.(event.nativeEvent.region, event.nativeEvent.details)
          }
          onMapReady={() => onMapReady?.()}
          onUserLocationChange={(event: EventPayload<{ coordinate: Coordinate }>) =>
            onUserLocationChange?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerPress={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerPressHandlers
              .get(event.nativeEvent.id)
              ?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerSelect={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerSelectHandlers
              .get(event.nativeEvent.id)
              ?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerDeselect={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDeselectHandlers
              .get(event.nativeEvent.id)
              ?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerDragStart={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDragStartHandlers
              .get(event.nativeEvent.id)
              ?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerDrag={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDragHandlers
              .get(event.nativeEvent.id)
              ?.({ coordinate: event.nativeEvent.coordinate })
          }
          onMarkerDragEnd={(event: EventPayload<{ id: string; coordinate: Coordinate }>) =>
            parsed.markerDragEndHandlers
              .get(event.nativeEvent.id)
              ?.({ coordinate: event.nativeEvent.coordinate })
          }
          onCalloutPress={(event: EventPayload<{ id: string }>) =>
            parsed.calloutPressHandlers.get(event.nativeEvent.id)?.()
          }
          onPolylinePress={(event: EventPayload<{ id: string }>) =>
            parsed.polylinePressHandlers.get(event.nativeEvent.id)?.()
          }
          collapsable={Platform.OS === 'android' ? false : props.collapsable}
        />
        {(Platform.OS === 'android' || Platform.OS === 'ios') && parsed.markerSnapshots.length > 0 ? (
          <View pointerEvents="none" style={styles.markerSnapshotRoot}>
            {parsed.markerSnapshots.map(snapshot => (
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
      </>
    );
  },
);

MapView.displayName = 'RNCustomMapView';

const styles = StyleSheet.create({
  markerSnapshotRoot: {
    position: 'absolute',
    left: -10000,
    top: -10000,
    alignItems: 'flex-start',
  },
});

export default MapView;
