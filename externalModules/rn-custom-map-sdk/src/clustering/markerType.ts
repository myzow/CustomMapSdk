/**
 * Pure helpers that decide how a cluster engine output is mapped onto the
 * native marker list + snapshot list. Extracted from MapView so the
 * marker-type-preservation rule is trivially unit-testable.
 *
 * Rule (per product spec):
 *
 *   - Marker WITH children       → custom marker (React-view snapshot).
 *   - Marker WITHOUT children    → native pin (pinColor / image / icon).
 *   - Cluster with 2+ members    → synthetic cluster marker via renderCluster.
 *   - Cluster with 1 member      → re-emit the ORIGINAL marker (preserving
 *                                  its custom-vs-native type). NEVER wrap
 *                                  the singleton in a cluster bubble.
 *
 * The helper is intentionally generic over the native-marker and snapshot
 * shapes; MapView passes through the concrete `NativeMarker` and
 * `MarkerSnapshot` types and gets a properly-typed output back.
 */

export type MarkerLite = { id: string };
export type SnapshotLite = { id: string };
export type ClusterLite = {
  id: string;
  pointCount: number;
  markerIds: readonly string[];
  coordinate: { latitude: number; longitude: number };
};

export type ResolveClusterInput<TMarker extends MarkerLite, TSnap extends SnapshotLite> = {
  cluster: ClusterLite;
  /** Quick lookup for the marker payload built from the original <Marker>. */
  markerById: ReadonlyMap<string, TMarker>;
  /** Quick lookup for the original custom-children snapshot (if any). */
  snapshotByMarkerId: ReadonlyMap<string, TSnap>;
  /** True when the original <Marker> was created with custom children. */
  isCustomById: ReadonlyMap<string, boolean>;
  /**
   * Builders for the multi-cluster case. The helper does not know how to
   * build a synthetic marker / snapshot; the caller supplies them.
   */
  makeClusterMarker: (cluster: ClusterLite) => TMarker;
  makeClusterSnapshot: (cluster: ClusterLite, syntheticId: string) => TSnap;
};

export type ResolvedCluster<TMarker extends MarkerLite, TSnap extends SnapshotLite> = {
  /** The native marker payload to push. Always exactly one. */
  marker: TMarker;
  /**
   * The snapshot to push, if any. Native-pin singletons return `undefined`
   * here so the snapshot pipeline does not overwrite the pin.
   */
  snapshot?: TSnap;
  /**
   * True when this resolution represents a multi-marker cluster. Used by
   * the caller to register the cluster in its press dispatcher map.
   */
  isCluster: boolean;
};

/**
 * Resolves a single cluster into the marker+snapshot pair to render.
 *
 *   pointCount === 1 → returns the ORIGINAL marker entry (and snapshot
 *   if custom). The native side keeps its existing marker instance + any
 *   cached bitmap, so the user never sees a pin flash.
 *
 *   pointCount >= 2 → builds a synthetic cluster marker via the supplied
 *   factories.
 *
 * Returns `null` if a singleton's original marker can't be located (the
 * marker disappeared between recomputes — race window, harmless to skip).
 */
export function resolveCluster<TMarker extends MarkerLite, TSnap extends SnapshotLite>(
  input: ResolveClusterInput<TMarker, TSnap>,
): ResolvedCluster<TMarker, TSnap> | null {
  const { cluster, markerById, snapshotByMarkerId, isCustomById } = input;

  if (cluster.pointCount === 1) {
    const memberId = cluster.markerIds[0];
    if (!memberId) return null;
    const original = markerById.get(memberId);
    if (!original) return null;
    const isCustom = isCustomById.get(memberId) === true;
    const snap = isCustom ? snapshotByMarkerId.get(memberId) : undefined;
    return { marker: original, snapshot: snap, isCluster: false };
  }

  // Multi-marker — synthesize.
  const marker = input.makeClusterMarker(cluster);
  const snapshot = input.makeClusterSnapshot(cluster, marker.id);
  return { marker, snapshot, isCluster: true };
}
