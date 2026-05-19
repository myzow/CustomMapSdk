/**
 * Performance helpers for the clustering pipeline.
 *
 * Kept in a separate, RN-free module so the logic is trivially unit-testable
 * without booting the React Native runtime. All functions are pure.
 */

export type RegionLite = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type ViewportLite = { width: number; height: number };

/**
 * Web-Mercator-style zoom level derived from the horizontal span of the
 * visible region. Zoom 0 covers 360° of longitude; each integer step halves
 * the span. Returns 0 for invalid regions.
 */
export function regionToZoom(longitudeDelta: number): number {
  if (!Number.isFinite(longitudeDelta) || longitudeDelta <= 0) return 0;
  return Math.log2(360 / longitudeDelta);
}

/**
 * Approximate on-screen pixel distance between two coordinates using the
 * current region + viewport as the projection. Good enough for "did the
 * user drag the map by N pixels?" — not for cartographic accuracy.
 */
export function pixelDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  region: { latitudeDelta: number; longitudeDelta: number },
  viewport: ViewportLite,
): number {
  if (
    !region ||
    region.longitudeDelta <= 0 ||
    region.latitudeDelta <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return 0;
  }
  const dx = ((a.longitude - b.longitude) * viewport.width) / region.longitudeDelta;
  const dy = ((a.latitude - b.latitude) * viewport.height) / region.latitudeDelta;
  return Math.sqrt(dx * dx + dy * dy);
}

export type ShouldRecomputeInput = {
  previousRegion: RegionLite | undefined;
  currentRegion: RegionLite;
  viewport: ViewportLite;
  renderThreshold: number;
  dragThreshold: number;
};

/**
 * Returns true when the camera has moved enough since the last computed
 * region to justify rebuilding clusters. The very first call (no previous
 * region) always returns true.
 */
export function shouldRecompute({
  previousRegion,
  currentRegion,
  viewport,
  renderThreshold,
  dragThreshold,
}: ShouldRecomputeInput): boolean {
  if (!previousRegion) return true;

  const zoomDiff = Math.abs(
    regionToZoom(currentRegion.longitudeDelta) -
      regionToZoom(previousRegion.longitudeDelta),
  );
  if (zoomDiff >= renderThreshold) return true;

  const px = pixelDistance(
    { latitude: currentRegion.latitude, longitude: currentRegion.longitude },
    { latitude: previousRegion.latitude, longitude: previousRegion.longitude },
    currentRegion,
    viewport,
  );
  return px >= dragThreshold;
}

/**
 * Bucketed zoom key used to memoize cluster results. Two regions whose zoom
 * levels fall in the same bucket reuse the same cache entry, which keeps the
 * cluster bubbles stable during sub-threshold pan/zoom.
 */
export function zoomBucketKey(longitudeDelta: number, renderThreshold: number): string {
  const zoom = regionToZoom(longitudeDelta);
  const step = renderThreshold > 0 ? renderThreshold : 0.5;
  return Math.round(zoom / step).toString();
}
