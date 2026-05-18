/**
 * Pure-JS clustering engine for rn-custom-map-sdk.
 *
 * Design goals:
 *   - O(n) grid bucketing in screen-pixel space — fast for tens of thousands
 *     of markers without any spatial index.
 *   - Stable cluster IDs across re-clustering passes so React reconciliation
 *     does not thrash the snapshot views (would otherwise cause flicker).
 *   - Zero dependencies. Web-portable (no React Native imports).
 *
 * Used directly when native clustering is unavailable, OR consumed by the
 * MapView component as a post-processing step over native-computed bucket
 * IDs (native only returns id groupings; JS enriches them with marker.data
 * so renderCluster() retains full access to images, names, anything).
 */

export type ClusterPoint = {
  id: string;
  coordinate: { latitude: number; longitude: number };
  data?: any;
  title?: string;
};

export type Cluster = {
  id: string;
  coordinate: { latitude: number; longitude: number };
  pointCount: number;
  markerIds: string[];
  markers: Array<{
    id: string;
    coordinate: { latitude: number; longitude: number };
    data?: any;
    title?: string;
  }>;
};

export type ClusterInput = {
  points: ClusterPoint[];
  /** Current visible region of the map. */
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  /** Pixel size of the map viewport. */
  viewport: { width: number; height: number };
  /** Cluster radius in screen pixels. Defaults to 60. */
  radius?: number;
  /**
   * Marker IDs that must NOT participate in clustering. They get returned
   * as single-point clusters (pointCount = 1) so the MapView can render them
   * as ordinary markers.
   */
  ignoreClusterIds?: ReadonlyArray<string> | ReadonlySet<string>;
  /**
   * Pre-computed bucket assignments coming from the native side. When set,
   * the JS engine skips its own grid pass and simply groups by bucket id,
   * which is the "native-with-JS-fallback" code path.
   */
  nativeBuckets?: ReadonlyArray<{
    bucketId: string;
    markerIds: ReadonlyArray<string>;
    coordinate: { latitude: number; longitude: number };
  }>;
};

const EARTH_CIRCUMFERENCE_DEG = 360;

function toSet(value: ClusterInput['ignoreClusterIds']): Set<string> {
  if (!value) return new Set();
  if (value instanceof Set) return value as Set<string>;
  return new Set(value as string[]);
}

/**
 * Build clusters for a set of points. The algorithm projects each point into
 * pixel space using a flat-projection approximation (good enough for cluster
 * grouping — never used for actual map rendering), bins them into a grid of
 * size `radius`, and emits one cluster per non-empty cell.
 */
export function clusterPoints(input: ClusterInput): Cluster[] {
  const { points, region, viewport } = input;
  const radius = Math.max(input.radius ?? 60, 1);
  const ignore = toSet(input.ignoreClusterIds);

  // Singletons + ignored markers always pass through verbatim.
  const passthrough: Cluster[] = [];
  const clusterable: ClusterPoint[] = [];

  for (const p of points) {
    if (ignore.has(p.id)) {
      passthrough.push(toSingleton(p));
    } else {
      clusterable.push(p);
    }
  }

  if (clusterable.length === 0) return passthrough;

  // --- native-bucket fast path -------------------------------------------
  if (input.nativeBuckets && input.nativeBuckets.length > 0) {
    const byId = new Map(clusterable.map(p => [p.id, p]));
    const out: Cluster[] = [...passthrough];
    for (const bucket of input.nativeBuckets) {
      const members: ClusterPoint[] = [];
      for (const id of bucket.markerIds) {
        const p = byId.get(id);
        if (p) members.push(p);
      }
      if (members.length === 0) continue;
      out.push(buildCluster(bucket.bucketId, members, bucket.coordinate));
    }
    return out;
  }

  // --- JS pixel-grid path -------------------------------------------------
  if (region.longitudeDelta <= 0 || region.latitudeDelta <= 0) {
    // Degenerate region — treat every point as its own cluster.
    return [...passthrough, ...clusterable.map(toSingleton)];
  }

  const pxPerLng = viewport.width / region.longitudeDelta;
  const pxPerLat = viewport.height / region.latitudeDelta;
  const cellLng = radius / pxPerLng;
  const cellLat = radius / pxPerLat;

  const grid = new Map<string, ClusterPoint[]>();
  for (const p of clusterable) {
    // Wrap longitude across the anti-meridian so points on either side of
    // ±180° cluster together when within `radius` pixels of each other.
    const lng = wrapLongitude(p.coordinate.longitude, region.longitude);
    const cx = Math.floor(lng / cellLng);
    const cy = Math.floor(p.coordinate.latitude / cellLat);
    const key = `${cx}:${cy}`;
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(p);
  }

  const out: Cluster[] = [...passthrough];
  for (const [key, members] of grid) {
    out.push(buildCluster(`grid:${key}`, members));
  }
  return out;
}

function buildCluster(
  id: string,
  members: ClusterPoint[],
  presetCenter?: { latitude: number; longitude: number },
): Cluster {
  if (members.length === 1) {
    return toSingleton(members[0]);
  }
  let latSum = 0;
  let lngSum = 0;
  const markerIds: string[] = [];
  const enriched: Cluster['markers'] = [];
  for (const m of members) {
    latSum += m.coordinate.latitude;
    lngSum += m.coordinate.longitude;
    markerIds.push(m.id);
    enriched.push({
      id: m.id,
      coordinate: m.coordinate,
      data: m.data,
      title: m.title,
    });
  }
  return {
    id,
    coordinate: presetCenter ?? {
      latitude: latSum / members.length,
      longitude: lngSum / members.length,
    },
    pointCount: members.length,
    markerIds,
    markers: enriched,
  };
}

function toSingleton(p: ClusterPoint): Cluster {
  return {
    id: `single:${p.id}`,
    coordinate: p.coordinate,
    pointCount: 1,
    markerIds: [p.id],
    markers: [{ id: p.id, coordinate: p.coordinate, data: p.data, title: p.title }],
  };
}

function wrapLongitude(lng: number, regionCenterLng: number): number {
  // If we're near the anti-meridian, normalize longitudes onto a continuous
  // range centered on the visible region.
  if (regionCenterLng > 90 && lng < -90) return lng + 360;
  if (regionCenterLng < -90 && lng > 90) return lng - 360;
  return lng;
}

export const __EARTH_DEG = EARTH_CIRCUMFERENCE_DEG; // exposed for tests
