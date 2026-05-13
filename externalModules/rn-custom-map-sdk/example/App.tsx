import React, { useRef } from 'react';
import { Button, SafeAreaView, StyleSheet } from 'react-native';
import MapView, {
  Callout,
  Circle,
  Marker,
  Polyline,
  type MapViewMethods,
} from 'rn-custom-map-sdk';

const region = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function App() {
  const mapRef = useRef<MapViewMethods>(null);

  return (
    <SafeAreaView style={styles.container}>
      <MapView ref={mapRef} style={styles.map} initialRegion={region}>
        <Marker
          coordinate={{ latitude: 37.78825, longitude: -122.4324 }}
          title="Custom marker"
          description="Powered by rn-custom-map-sdk"
          draggable
        >
          <Callout onPress={() => console.log('callout')} />
        </Marker>
        <Polyline
          coordinates={[
            { latitude: 37.78825, longitude: -122.4324 },
            { latitude: 37.79825, longitude: -122.4224 },
          ]}
          strokeColor="#0a84ff"
          strokeWidth={4}
        />
        <Circle
          center={{ latitude: 37.78825, longitude: -122.4324 }}
          radius={500}
          strokeColor="#ff3b30"
          fillColor="#ff3b3033"
        />
      </MapView>
      <Button
        title="Go to marker"
        onPress={() =>
          mapRef.current?.animateToCoordinate(
            { latitude: 37.78825, longitude: -122.4324 },
            400,
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
