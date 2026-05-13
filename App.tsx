// import React, { useRef } from 'react';
// import {
//   Button,
//   Image,
//   SafeAreaView,
//   StyleSheet,
//   View,
//   Text,
// } from 'react-native';

// import MapView, {
//   Callout,
//   Circle,
//   Marker,
//   type MapViewMethods,
// } from 'rn-custom-map-sdk';

// const region = {
//   latitude: 37.78825,
//   longitude: -122.4324,
//   latitudeDelta: 0.05,
//   longitudeDelta: 0.05,
// };

// export default function App() {
//   const mapRef = useRef<MapViewMethods>(null);

//   return (
//     <SafeAreaView style={styles.container}>
//       <MapView
//         ref={mapRef}
//         style={styles.map}
//         provider="google"
//         initialRegion={region}
//         onMapReady={() => console.log('map ready')}
//       >
//         <Marker
//           coordinate={{
//             latitude: 37.78825,
//             longitude: -122.4324,
//           }}
//           title="Custom Marker"
//           description="Powered by rn-custom-map-sdk"
//           draggable
//           onPress={() => console.log('marker press')}
//         >
//           <View style={styles.markerContainer}>
//             <Image
//               source={{
//                 uri: 'https://images.unsplash.com/photo-1526045612212-70caf35c14df?q=80&w=400',
//               }}
//               style={styles.markerImage}
//               resizeMode="cover"
//             />

//             <Text style={styles.markerText}>Sample Image</Text>
//           </View>

//           <Callout onPress={() => console.log('callout pressed')}>
//             <View style={styles.calloutContainer}>
//               <Text style={styles.calloutTitle}>Custom Marker</Text>

//               <Image
//                 source={{
//                   uri: 'https://images.unsplash.com/photo-1526045612212-70caf35c14df?q=80&w=400',
//                 }}
//                 style={styles.calloutImage}
//                 resizeMode="cover"
//               />

//               <Text style={styles.calloutDescription}>
//                 This is a custom marker with image preview.
//               </Text>
//             </View>
//           </Callout>
//         </Marker>

//         <Circle
//           center={{
//             latitude: 37.78825,
//             longitude: -122.4324,
//           }}
//           radius={500}
//           strokeColor="#ff3b30"
//           fillColor="#e6241abd"
//         />
//       </MapView>

//       <Button
//         title="Go to marker"
//         onPress={() =>
//           mapRef.current?.animateToCoordinate(
//             {
//               latitude: 37.78825,
//               longitude: -122.4324,
//             },
//             400,
//           )
//         }
//       />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     paddingVertical: 40,
//   },

//   map: {
//     flex: 1,
//   },

//   markerContainer: {
//     alignItems: 'center',
//     backgroundColor: '#fff',
//     borderRadius: 12,
//     padding: 6,
//     borderWidth: 1,
//     borderColor: '#ddd',
//   },

//   markerImage: {
//     width: 60,
//     height: 60,
//     borderRadius: 30,
//   },

//   markerText: {
//     marginTop: 4,
//     fontSize: 12,
//     fontWeight: '600',
//   },

//   calloutContainer: {
//     width: 220,
//     padding: 10,
//   },

//   calloutTitle: {
//     fontSize: 16,
//     fontWeight: '700',
//     marginBottom: 8,
//   },

//   calloutImage: {
//     width: '100%',
//     height: 120,
//     borderRadius: 10,
//   },

//   calloutDescription: {
//     marginTop: 8,
//     fontSize: 13,
//     color: '#444',
//   },
// });

import React, { useRef, useState } from 'react';
import {
  Button,
  Image,
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';

import MapView, {
  Callout,
  Circle,
  Marker,
  type MapViewMethods,
  type MarkerMethods,
} from 'rn-custom-map-sdk';

const INITIAL_REGION = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

const SAN_FRANCISCO = {
  latitude: 37.7749,
  longitude: -122.4194,
};

const OAKLAND = {
  latitude: 37.8044,
  longitude: -122.2712,
};

const BERKELEY = {
  latitude: 37.8715,
  longitude: -122.2727,
};

export default function App() {
  const mapRef = useRef<MapViewMethods>(null);
  const markerRef = useRef<MarkerMethods>(null);
  const [markerCoordinate, setMarkerCoordinate] = useState(SAN_FRANCISCO);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);

  // 1. animateToCoordinate - Move map to specific coordinate
  const handleAnimateToCoordinate = () => {
    console.log('Animating to San Francisco...');
    mapRef.current?.animateToCoordinate(SAN_FRANCISCO, 500);
  };

  // 2. animateToRegion - Move map to region with zoom
  const handleAnimateToRegion = () => {
    console.log('Animating to region...');
    mapRef.current?.animateToRegion(
      {
        latitude: 37.8,
        longitude: -122.3,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      },
      600,
    );
  };

  // 3. fitToElements - Fit map to show all markers
  const handleFitToElements = () => {
    console.log('Fitting to all elements...');
    mapRef.current?.fitToElements({ animated: true });
  };

  // 4. fitToSuppliedMarkers - Fit to specific markers by identifier
  const handleFitToMarkers = () => {
    console.log('Fitting to SF and Oakland markers...');
    mapRef.current?.fitToSuppliedMarkers(['sf-marker', 'oakland-marker'], 60);
  };

  // 5. getCamera / setCamera - Get and set camera position
  const handleGetCamera = async () => {
    try {
      const camera = await mapRef.current?.getCamera();
      console.log('Current camera:', camera);
      Alert.alert(
        'Camera Info',
        `Zoom: ${camera?.zoom}\nHeading: ${camera?.heading}`,
      );
    } catch (error) {
      console.error('Failed to get camera:', error);
    }
  };

  const handleSetCamera = () => {
    console.log('Setting camera to Berkeley...');
    mapRef.current?.setCamera({
      center: BERKELEY,
      zoom: 14,
      heading: 0,
      pitch: 45,
    });
  };

  // 6. Marker Ref Methods
  const handleShowCallout = () => {
    console.log('Showing callout...');
    markerRef.current?.showCallout();
  };

  const handleHideCallout = () => {
    console.log('Hiding callout...');
    markerRef.current?.hideCallout();
  };

  const handleRedrawMarker = () => {
    console.log('Redrawing marker...');
    markerRef.current?.redraw();
  };

  const handleAnimateMarker = () => {
    console.log('Animating marker to new position...');
    const newCoordinate =
      markerCoordinate.latitude === SAN_FRANCISCO.latitude
        ? OAKLAND
        : SAN_FRANCISCO;
    setMarkerCoordinate(newCoordinate);
    markerRef.current?.animateMarkerToCoordinate(newCoordinate, 800);
  };

  // 7. Marker Events
  const handleMarkerPress = (event: any) => {
    console.log('Marker pressed:', event.nativeEvent);
    Alert.alert('Marker Pressed', `Coordinates: ${JSON.stringify(event)}`);
  };

  const handleMarkerDragStart = (event: any) => {
    setIsDragging(true);
    console.log('Drag started:', event);
  };

  const handleMarkerDrag = (event: any) => {
    console.log('Dragging:', event);
  };

  const handleMarkerDragEnd = (event: any) => {
    setIsDragging(false);
    const newCoord = event;
    console.log('Drag ended at:', newCoord);
    setMarkerCoordinate(newCoord);
    Alert.alert(
      'Marker Moved',
      `New position: ${newCoord.latitude.toFixed(
        4,
      )}, ${newCoord.longitude.toFixed(4)}`,
    );
  };

  const handleMarkerSelect = (event: any) => {
    console.log('Marker selected:', event.nativeEvent);
    setSelectedMarker('sf-marker');
  };

  const handleMarkerDeselect = (event: any) => {
    console.log('Marker deselected:', event.nativeEvent);
    setSelectedMarker(null);
  };

  const handleCalloutPress = () => {
    console.log('Callout pressed!');
    Alert.alert('Callout', 'You tapped the callout!');
  };

  // 8. Map Events
  const handleMapReady = () => {
    console.log('Map is ready!');
    Alert.alert('Map Ready', 'rn-custom-map-sdk is loaded!');
  };

  const handleMapPress = (event: any) => {
    console.log('Map pressed:', event);
  };

  const handleMapLongPress = (event: any) => {
    console.log('Map long pressed:', event);
    setMarkerCoordinate(event);
  };

  return (
    <SafeAreaView style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider="google" // Use "apple" for iOS MapKit
        initialRegion={INITIAL_REGION}
        onMapReady={handleMapReady}
        onPress={handleMapPress}
        onLongPress={handleMapLongPress}
        showsUserLocation={true}
        zoomEnabled={true}
        rotateEnabled={true}
        scrollEnabled={true}
        pitchEnabled={true}
      >
        {/* ===== MARKER 1: Custom Component Marker with Full Features ===== */}
        <Marker
          ref={markerRef}
          identifier="sf-marker"
          coordinate={markerCoordinate}
          title="Custom Marker"
          description="This marker supports all features!"
          draggable={true}
          tappable={true}
          flat={false}
          rotation={isDragging ? 0 : 0}
          opacity={1.0}
          anchor={{ x: 0.5, y: 1 }}
          centerOffset={{ x: 0, y: 0 }}
          calloutOffset={{ x: 0, y: 0 }}
          calloutAnchor={{ x: 0.5, y: 0 }}
          tracksViewChanges={true}
          onPress={handleMarkerPress}
          onSelect={handleMarkerSelect}
          onDeselect={handleMarkerDeselect}
          onDragStart={handleMarkerDragStart}
          onDrag={handleMarkerDrag}
          onDragEnd={handleMarkerDragEnd}
          onCalloutPress={handleCalloutPress}
        >
          <View
            style={[
              styles.markerContainer,
              selectedMarker === 'sf-marker' && styles.markerContainerSelected,
              isDragging && styles.markerContainerDragging,
            ]}
          >
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1526045612212-70caf35c14df?q=80&w=400',
              }}
              style={styles.markerImage}
              resizeMode="cover"
            />
            <Text style={styles.markerText}>
              {isDragging ? 'Dragging...' : 'SF Marker'}
            </Text>
            {selectedMarker === 'sf-marker' && (
              <View style={styles.selectedBadge}>
                <Text style={styles.selectedBadgeText}>✓</Text>
              </View>
            )}
          </View>

          <Callout onPress={handleCalloutPress} tooltip={false}>
            <View style={styles.calloutContainer}>
              <Text style={styles.calloutTitle}>✨ Custom Marker</Text>

              <Image
                source={{
                  uri: 'https://images.unsplash.com/photo-1526045612212-70caf35c14df?q=80&w=400',
                }}
                style={styles.calloutImage}
                resizeMode="cover"
              />

              <Text style={styles.calloutDescription}>
                This is a fully functional custom marker with: • Drag & Drop •
                Custom Callout • Animate to position • All ref methods
              </Text>

              <TouchableOpacity
                style={styles.calloutButton}
                onPress={() =>
                  Alert.alert('Action', 'Button inside callout pressed!')
                }
              >
                <Text style={styles.calloutButtonText}>Learn More →</Text>
              </TouchableOpacity>
            </View>
          </Callout>
        </Marker>

        {/* ===== MARKER 2: Simple Marker with Pin Color ===== */}
        <Marker
          identifier="oakland-marker"
          coordinate={OAKLAND}
          title="Oakland"
          description="Simple colored marker"
          pinColor="#34c759" // Green pin (iOS) / Android fallback
          onPress={() => console.log('Oakland marker pressed')}
        />

        {/* ===== MARKER 3: Marker with Icon Image ===== */}
        <Marker
          identifier="berkeley-marker"
          coordinate={BERKELEY}
          title="UC Berkeley"
          description="Custom icon marker"
          image={{
            uri: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
          }}
          anchor={{ x: 0.5, y: 0.5 }}
          rotation={45}
          opacity={0.9}
          onPress={() => console.log('Berkeley marker pressed')}
        >
        </Marker>

        {/* ===== CIRCLE 1: Basic Circle ===== */}
        <Circle
          center={SAN_FRANCISCO}
          radius={800}
          strokeColor="#ff3b30"
          strokeWidth={3}
          fillColor="#ff3b3040" // 25% opacity
          zIndex={1}
        />

        {/* ===== CIRCLE 2: Another Circle ===== */}
        <Circle
          center={OAKLAND}
          radius={600}
          strokeColor="#34c759"
          strokeWidth={2}
          fillColor="#34c75920"
          zIndex={0}
        />
      </MapView>

      {/* ===== Control Panel with all methods ===== */}
      <ScrollView
        style={styles.controlPanel}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.panelTitle}>🎮 Map Controls</Text>

        {/* Map View Methods */}
        <Text style={styles.sectionTitle}>📍 Map View Methods</Text>
        <View style={styles.buttonGrid}>
          <TouchableOpacity
            style={styles.button}
            onPress={handleAnimateToCoordinate}
          >
            <Text style={styles.buttonText}>animateToCoordinate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.button}
            onPress={handleAnimateToRegion}
          >
            <Text style={styles.buttonText}>animateToRegion</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleFitToElements}>
            <Text style={styles.buttonText}>fitToElements</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleFitToMarkers}>
            <Text style={styles.buttonText}>fitToSuppliedMarkers</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleGetCamera}>
            <Text style={styles.buttonText}>getCamera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleSetCamera}>
            <Text style={styles.buttonText}>setCamera</Text>
          </TouchableOpacity>
        </View>

        {/* Marker Ref Methods */}
        <Text style={styles.sectionTitle}>🎯 Marker Ref Methods</Text>
        <View style={styles.buttonGrid}>
          <TouchableOpacity style={styles.button} onPress={handleShowCallout}>
            <Text style={styles.buttonText}>showCallout</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleHideCallout}>
            <Text style={styles.buttonText}>hideCallout</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleRedrawMarker}>
            <Text style={styles.buttonText}>redraw</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={handleAnimateMarker}>
            <Text style={styles.buttonText}>animateMarkerToCoordinate</Text>
          </TouchableOpacity>
        </View>

        {/* Status Indicators */}
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {isDragging
              ? '🟢 Marker is being dragged...'
              : '⚪ Marker not dragging'}
          </Text>
          <Text style={styles.statusText}>
            {selectedMarker
              ? `🔵 Selected: ${selectedMarker}`
              : '⚪ No marker selected'}
          </Text>
          <Text style={styles.statusText}>
            📍 Marker at: {markerCoordinate.latitude.toFixed(4)},{' '}
            {markerCoordinate.longitude.toFixed(4)}
          </Text>
          <Text style={styles.statusText}>🖥️ Platform: {Platform.OS}</Text>
        </View>

        <Text style={styles.note}>
          💡 Tip: Try dragging the custom marker! All events are logged to
          console and trigger alerts.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  map: {
    flex: 2,
    margin: 12,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
    }),
  },

  // Custom Marker Styles
  markerContainer: {
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 8,
    borderWidth: 2,
    borderColor: '#ff3b30',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  markerContainerSelected: {
    borderColor: '#34c759',
    transform: [{ scale: 1.1 }],
  },
  markerContainerDragging: {
    opacity: 0.8,
    transform: [{ scale: 1.2 }],
    borderColor: '#ff9f0a',
  },
  markerImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  markerText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  selectedBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#34c759',
    borderRadius: 12,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Callout Styles
  calloutContainer: {
    width: 260,
    padding: 12,
    backgroundColor: 'white',
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  calloutTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  calloutImage: {
    width: '100%',
    height: 120,
    borderRadius: 10,
    marginBottom: 8,
  },
  calloutDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 12,
  },
  calloutButton: {
    backgroundColor: '#007aff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  calloutButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },

  // Control Panel Styles
  controlPanel: {
    flex: 1,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    color: '#1a1a1a',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 8,
    color: '#555',
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#007aff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  statusContainer: {
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 12,
    color: '#333',
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  note: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 20,
    fontStyle: 'italic',
  },
});
