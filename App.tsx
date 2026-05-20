/**
 * Demo app showing the two Android fixes baked into rn-custom-map-sdk:
 *
 *   1. Edge indicators on every tab call mapRef.current.animateToRegion(...)
 *      via the new viewRegistry-based native lookup. Works reliably even
 *      from event handlers that fire pre-commit (which was the original bug).
 *
 *   2. Each tab is a SEPARATE <MapView> wired to useMapTabLifecycle(), which
 *      drives the embedded Google MapView's lifecycle in lockstep with the
 *      navigator's focus state — no more white screen on API 30 / 33 after
 *      switching tabs.
 */
import 'react-native-gesture-handler';
import React from 'react';
import { Text, View, StyleSheet, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import TabbedMapScreen from './src/screens/TabbedMapScreen';
import ClusteringScreen from './src/screens/ClusteringScreen';
import AllMarkersScreen from './src/screens/AllMarkersScreen';

const Tab = createBottomTabNavigator();

const SF = { latitude: 37.7749, longitude: -122.4194 };
const NYC = { latitude: 40.7128, longitude: -74.006 };
const TOKYO = { latitude: 35.6762, longitude: 139.6503 };

const tabIcon = (glyph: string, color: string) => (
  <View style={[styles.icon, { borderColor: color }]}>
    <Text style={[styles.iconText, { color }]}>{glyph}</Text>
  </View>
);

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0d1117' },
          headerTitleStyle: { color: '#e7ecf2', fontWeight: '700' },
          tabBarStyle: {
            backgroundColor: '#0d1117',
            borderTopColor: '#1f242b',
          },
          tabBarActiveTintColor: '#7ee787',
          tabBarInactiveTintColor: '#6e7681',
        }}
      >
        <Tab.Screen
          name="SF"
          options={{
            title: 'San Francisco',
            tabBarIcon: ({ color }) => tabIcon('SF', color),
          }}
        >
          {() => (
            <TabbedMapScreen label="SF" center={SF} accent="#7ee787" />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="NYC"
          options={{
            title: 'New York',
            tabBarIcon: ({ color }) => tabIcon('NY', color),
          }}
        >
          {() => (
            <TabbedMapScreen label="NYC" center={NYC} accent="#79c0ff" />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="Tokyo"
          options={{
            title: 'Tokyo',
            tabBarIcon: ({ color }) => tabIcon('TK', color),
          }}
        >
          {() => (
            <TabbedMapScreen label="Tokyo" center={TOKYO} accent="#ff7b72" />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="Cluster"
          component={ClusteringScreen}
          options={{
            title: 'Clustering',
            tabBarIcon: ({ color }) => tabIcon('CL', color),
          }}
        />

        <Tab.Screen
          name="AllMarkers"
          component={AllMarkersScreen}
          options={{
            title: 'All Markers',
            tabBarIcon: ({ color }) => tabIcon('AL', color),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
