import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import MapView, {
  Marker,
  type MapViewMethods,
  useMapTabLifecycle,
} from 'rn-custom-map-sdk';

/**
 * A screen that demonstrates BOTH fixes at once:
 *
 *  - useMapTabLifecycle(mapRef): handles the bottom-tab focus / blur cycle
 *    and prevents the white-screen bug on Android API 30/33.
 *
 *  - Edge indicators in the four corners: each one calls
 *    mapRef.current.animateToRegion(...) which now reliably reaches the
 *    native view via the static viewRegistry.
 */
type Props = {
  label: string;
  center: { latitude: number; longitude: number };
  accent: string;
};

const NORTH_OFFSET = { lat: 0.02, lng: 0 };
const SOUTH_OFFSET = { lat: -0.02, lng: 0 };
const EAST_OFFSET = { lat: 0, lng: 0.04 };
const WEST_OFFSET = { lat: 0, lng: -0.04 };

export default function TabbedMapScreen({ label, center, accent }: Props) {
  const mapRef = useRef<MapViewMethods>(null);
  const [lastEdge, setLastEdge] = useState<string>('—');

  // The single line that fixes the bottom-tab white-screen bug.
  useMapTabLifecycle(mapRef);

  const flyTo = (
    name: string,
    offset: { lat: number; lng: number },
    delta = 0.05,
  ) => {
    setLastEdge(name);
    // This is the call that previously silently no-op'd from edge
    // indicators. With the native viewRegistry in place, it reliably
    // reaches the right RNCustomMapView.
    mapRef.current?.animateToRegion(
      {
        latitude: center.latitude + offset.lat,
        longitude: center.longitude + offset.lng,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      450,
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider="google"
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        <Marker
          identifier={`${label}-pin`}
          coordinate={center}
          title={label}
          pinColor={accent}
        />
      </MapView>

      {/* === Edge indicators (the bug repro surface for Issue 1) === */}
      <TouchableOpacity
        style={[styles.edge, styles.edgeTop, { borderColor: accent }]}
        onPress={() => flyTo('North', NORTH_OFFSET)}
        accessibilityLabel="pan-north"
      >
        <Text style={[styles.edgeText, { color: accent }]}>▲ N</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.edge, styles.edgeBottom, { borderColor: accent }]}
        onPress={() => flyTo('South', SOUTH_OFFSET)}
        accessibilityLabel="pan-south"
      >
        <Text style={[styles.edgeText, { color: accent }]}>▼ S</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.edge, styles.edgeLeft, { borderColor: accent }]}
        onPress={() => flyTo('West', WEST_OFFSET)}
        accessibilityLabel="pan-west"
      >
        <Text style={[styles.edgeText, { color: accent }]}>◀ W</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.edge, styles.edgeRight, { borderColor: accent }]}
        onPress={() => flyTo('East', EAST_OFFSET)}
        accessibilityLabel="pan-east"
      >
        <Text style={[styles.edgeText, { color: accent }]}>▶ E</Text>
      </TouchableOpacity>

      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          {label} · last edge: {lastEdge} · {Platform.OS}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101418' },
  map: { flex: 1 },

  edge: {
    position: 'absolute',
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(15,17,21,0.85)',
    borderWidth: 1.5,
    borderRadius: 999,
  },
  edgeTop: { top: 18, alignSelf: 'center', left: 0, right: 0, marginHorizontal: 'auto' as any, width: 64 },
  edgeBottom: { bottom: 70, alignSelf: 'center', left: 0, right: 0, marginHorizontal: 'auto' as any, width: 64 },
  edgeLeft: { left: 14, top: '50%', marginTop: -18 },
  edgeRight: { right: 14, top: '50%', marginTop: -18 },
  edgeText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },

  statusBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15,17,21,0.85)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  statusText: {
    color: '#e7ecf2',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
