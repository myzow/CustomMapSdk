/**
 * @format
 */

import {
  regionToZoom,
  pixelDistance,
  shouldRecompute,
  zoomBucketKey,
} from '../externalModules/rn-custom-map-sdk/src/clustering/throttle';

describe('regionToZoom', () => {
  test('zoom 0 covers the full 360° span', () => {
    expect(regionToZoom(360)).toBe(0);
  });

  test('each zoom step halves the longitude span', () => {
    expect(regionToZoom(180)).toBe(1);
    expect(regionToZoom(90)).toBe(2);
    expect(regionToZoom(45)).toBe(3);
  });

  test('returns 0 for invalid inputs', () => {
    expect(regionToZoom(0)).toBe(0);
    expect(regionToZoom(-1)).toBe(0);
    expect(regionToZoom(NaN)).toBe(0);
  });
});

describe('pixelDistance', () => {
  const region = { latitudeDelta: 1, longitudeDelta: 1 };
  const viewport = { width: 1000, height: 1000 };

  test('pure longitude shift maps proportionally to viewport width', () => {
    const dx = pixelDistance(
      { latitude: 0, longitude: 0.1 },
      { latitude: 0, longitude: 0 },
      region,
      viewport,
    );
    expect(dx).toBeCloseTo(100, 5);
  });

  test('zero distance for identical coordinates', () => {
    const d = pixelDistance(
      { latitude: 10, longitude: 20 },
      { latitude: 10, longitude: 20 },
      region,
      viewport,
    );
    expect(d).toBe(0);
  });

  test('degenerate region returns 0', () => {
    const d = pixelDistance(
      { latitude: 1, longitude: 1 },
      { latitude: 0, longitude: 0 },
      { latitudeDelta: 0, longitudeDelta: 0 },
      viewport,
    );
    expect(d).toBe(0);
  });
});

describe('shouldRecompute', () => {
  const viewport = { width: 1000, height: 1000 };
  const base = {
    latitude: 0,
    longitude: 0,
    latitudeDelta: 1,
    longitudeDelta: 1,
  };

  test('first call (no previous region) always recomputes', () => {
    expect(
      shouldRecompute({
        previousRegion: undefined,
        currentRegion: base,
        viewport,
        renderThreshold: 0.5,
        dragThreshold: 50,
      }),
    ).toBe(true);
  });

  test('returns false for small zoom + tiny pan below thresholds', () => {
    // ~0.01 zoom level change; 10px pan
    const slightly = { ...base, longitude: 0.01, longitudeDelta: 1.005 };
    expect(
      shouldRecompute({
        previousRegion: base,
        currentRegion: slightly,
        viewport,
        renderThreshold: 0.5,
        dragThreshold: 50,
      }),
    ).toBe(false);
  });

  test('returns true when zoom change crosses renderThreshold', () => {
    // Halve longitudeDelta → zoom diff = 1.0, which is >= 0.5
    const zoomed = { ...base, longitudeDelta: 0.5 };
    expect(
      shouldRecompute({
        previousRegion: base,
        currentRegion: zoomed,
        viewport,
        renderThreshold: 0.5,
        dragThreshold: 50,
      }),
    ).toBe(true);
  });

  test('returns true when pixel drag crosses dragThreshold', () => {
    // 0.1° longitude over a 1° span at 1000px viewport = 100px shift > 50px
    const dragged = { ...base, longitude: 0.1 };
    expect(
      shouldRecompute({
        previousRegion: base,
        currentRegion: dragged,
        viewport,
        renderThreshold: 0.5,
        dragThreshold: 50,
      }),
    ).toBe(true);
  });

  test('respects a custom higher dragThreshold', () => {
    const dragged = { ...base, longitude: 0.04 }; // 40px
    expect(
      shouldRecompute({
        previousRegion: base,
        currentRegion: dragged,
        viewport,
        renderThreshold: 0.5,
        dragThreshold: 50,
      }),
    ).toBe(false);
    expect(
      shouldRecompute({
        previousRegion: base,
        currentRegion: dragged,
        viewport,
        renderThreshold: 0.5,
        dragThreshold: 30,
      }),
    ).toBe(true);
  });
});

describe('zoomBucketKey', () => {
  test('identical zooms map to the same bucket', () => {
    expect(zoomBucketKey(1, 0.5)).toBe(zoomBucketKey(1, 0.5));
  });

  test('zoom changes within renderThreshold share a bucket', () => {
    // zoom(1) ≈ 8.49, zoom(1.05) ≈ 8.42 — both in bucket round(zoom / 0.5)
    expect(zoomBucketKey(1, 0.5)).toBe(zoomBucketKey(1.05, 0.5));
  });

  test('zoom changes exceeding renderThreshold get different buckets', () => {
    // longitudeDelta 1 vs 0.25 → 2 full zoom steps difference
    expect(zoomBucketKey(1, 0.5)).not.toBe(zoomBucketKey(0.25, 0.5));
  });
});
