/**
 * Cluster-membership stability helpers.
 *
 * Why this exists:
 *
 *   React's reconciliation treats `key` as the identity of a list item. If
 *   we hand React a fresh key for an unchanged cluster bubble every time
 *   clustering re-runs, it will unmount + remount the underlying View — and
 *   the native side will see "marker view removed, marker view added", at
 *   which point the bitmap is recomputed and the default pin briefly
 *   flashes through. That is the flicker.
 *
 *   The fix is to derive a *content-based* signature from the cluster's
 *   marker IDs (sorted, joined) so that:
 *
 *     - Adding/removing a member changes the signature → React intentionally
 *       remounts (correct behavior: the bubble's count badge is different).
 *     - Panning to keep the SAME members in view does NOT change the
 *       signature → React reuses the existing snapshot View → no flicker.
 *
 *   The signature is also used to look up a cached bitmap on the native
 *   side so that, even when remounting is unavoidable, the rendered bitmap
 *   is reused instantly instead of being re-rasterized.
 */

export type ClusterLike = {
  id: string;
  pointCount: number;
  markerIds: readonly string[];
};

/**
 * Builds a deterministic signature for a cluster. Members are sorted so
 * the order in which the underlying grid emits its buckets does not change
 * the key. Singleton clusters (pointCount === 1) bypass the sort entirely
 * — a single id is its own signature.
 *
 * Uses '|' as the separator because marker ids in practice never contain
 * it, and it avoids accidental collisions with ':' which the grid engine
 * uses internally.
 */
export function clusterSignature(cluster: ClusterLike): string {
  if (cluster.pointCount === 1) {
    // Cheap path — and singletons are by far the most common.
    return `s:${cluster.markerIds[0] ?? cluster.id}`;
  }
  // Avoid allocating a fresh array when the caller already gave us a
  // readonly one we shouldn't mutate. The Array.from + sort keeps the
  // signature deterministic across different cluster engines.
  const sorted = Array.from(cluster.markerIds).sort();
  return `m:${sorted.join('|')}`;
}

/**
 * Returns a stable React key for a cluster. The cluster's own `id` is
 * already grid-based (`grid:cx:cy`), but two adjacent recomputes that
 * include the same members in the SAME cell will share the same
 * signature too — and that's what React needs to keep the snapshot
 * mounted.
 *
 * The composite key prefixes with the cluster id so that singletons
 * generated from different grid cells don't collide.
 */
export function stableClusterKey(cluster: ClusterLike): string {
  return `${cluster.id}|${clusterSignature(cluster)}`;
}

/**
 * Diff helper used by the renderer to figure out which snapshots need to
 * be remounted vs. reused vs. removed. The cluster engine produces a
 * fresh array on every recompute; this turns that array into a stable
 * `{ added, removed, kept }` triplet so the renderer can avoid touching
 * the native side for clusters that didn't actually change.
 */
export type MembershipDiff = {
  added: ClusterLike[];
  removed: string[];
  /** Clusters whose signature is unchanged across recomputes. */
  kept: ClusterLike[];
};

export function diffMembership(
  previous: readonly ClusterLike[] | undefined,
  current: readonly ClusterLike[],
): MembershipDiff {
  if (!previous || previous.length === 0) {
    return { added: [...current], removed: [], kept: [] };
  }
  const prevByKey = new Map<string, ClusterLike>();
  for (const c of previous) {
    prevByKey.set(stableClusterKey(c), c);
  }
  const added: ClusterLike[] = [];
  const kept: ClusterLike[] = [];
  const seenKeys = new Set<string>();

  for (const c of current) {
    const k = stableClusterKey(c);
    seenKeys.add(k);
    if (prevByKey.has(k)) {
      kept.push(c);
    } else {
      added.push(c);
    }
  }
  const removed: string[] = [];
  for (const k of prevByKey.keys()) {
    if (!seenKeys.has(k)) removed.push(k);
  }
  return { added, removed, kept };
}
