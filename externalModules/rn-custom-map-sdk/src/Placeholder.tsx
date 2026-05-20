import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MarkerFallback } from './types';

/**
 * Placeholder bubble shown in place of a custom marker while its image is
 * still loading, has failed, or has not been registered with the native
 * cache yet. By design this NEVER falls back to the default Google pin —
 * the user must always see something app-branded, even on first frame.
 *
 * Defaults are intentionally neutral so it blends with any host design.
 * Callers can override `color`, `initial`, or wrap their own JSX in a
 * `<Marker>` child to fully customize.
 */
export function MarkerPlaceholder({
  fallback,
  size = 30,
}: {
  fallback?: MarkerFallback;
  size?: number;
}) {
  const color = fallback?.color ?? '#1f6feb';
  const initial = fallback?.initial?.trim();
  const ring = fallback?.ringColor ?? '#ffffff';

  const dynamicStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      borderColor: ring,
    }),
    [color, ring, size],
  );

  return (
    <View
      style={[styles.dot, dynamicStyle]}
      accessibilityLabel="marker-placeholder"
    >
      {initial && initial.length > 0 ? (
        <Text
          style={[
            styles.initial,
            { fontSize: Math.max(10, Math.round(size * 0.46)) },
          ]}
          numberOfLines={1}
        >
          {initial.charAt(0).toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    // Subtle shadow so it lifts off light tiles, but not so heavy that it
    // dominates dark/satellite map styles.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
  initial: {
    color: '#ffffff',
    fontWeight: '700',
    includeFontPadding: false,
  },
});

export default MarkerPlaceholder;
