/**
 * @format
 */

import { resolveCluster } from '../externalModules/rn-custom-map-sdk/src/clustering/markerType';

type M = { id: string; latitude: number; longitude: number };
type S = { id: string; tag: string };

function makeInput(
  clusterPointCount: number,
  members: string[],
  registry: Array<{ id: string; isCustom: boolean }>,
) {
  const markerById = new Map<string, M>();
  const snapshotByMarkerId = new Map<string, S>();
  const isCustomById = new Map<string, boolean>();
  for (const r of registry) {
    markerById.set(r.id, { id: r.id, latitude: 0, longitude: 0 });
    isCustomById.set(r.id, r.isCustom);
    if (r.isCustom) snapshotByMarkerId.set(r.id, { id: r.id, tag: 'original' });
  }
  return {
    cluster: {
      id: `c:${members.join(',')}`,
      pointCount: clusterPointCount,
      markerIds: members,
      coordinate: { latitude: 0, longitude: 0 },
    },
    markerById,
    snapshotByMarkerId,
    isCustomById,
    makeClusterMarker: (c: any): M => ({
      id: `cluster:${c.id}`,
      latitude: c.coordinate.latitude,
      longitude: c.coordinate.longitude,
    }),
    makeClusterSnapshot: (_c: any, syntheticId: string): S => ({
      id: syntheticId,
      tag: 'cluster',
    }),
  };
}

describe('resolveCluster — singleton restoration', () => {
  test('native singleton (no children) → original marker, NO snapshot', () => {
    const input = makeInput(1, ['m1'], [{ id: 'm1', isCustom: false }]);
    const r = resolveCluster(input);
    expect(r).not.toBeNull();
    expect(r!.isCluster).toBe(false);
    expect(r!.marker.id).toBe('m1');
    expect(r!.snapshot).toBeUndefined();
  });

  test('custom singleton (with children) → original marker + ORIGINAL snapshot', () => {
    const input = makeInput(1, ['m1'], [{ id: 'm1', isCustom: true }]);
    const r = resolveCluster(input);
    expect(r).not.toBeNull();
    expect(r!.isCluster).toBe(false);
    expect(r!.marker.id).toBe('m1');
    expect(r!.snapshot?.id).toBe('m1');
    expect(r!.snapshot?.tag).toBe('original'); // NOT 'cluster'
  });

  test('singleton whose original marker disappeared → returns null', () => {
    const input = makeInput(1, ['gone'], []);
    expect(resolveCluster(input)).toBeNull();
  });

  test('multi-cluster (2+) → synthetic cluster marker + cluster snapshot', () => {
    const input = makeInput(
      3,
      ['m1', 'm2', 'm3'],
      [
        { id: 'm1', isCustom: true },
        { id: 'm2', isCustom: false },
        { id: 'm3', isCustom: true },
      ],
    );
    const r = resolveCluster(input);
    expect(r).not.toBeNull();
    expect(r!.isCluster).toBe(true);
    expect(r!.marker.id).toMatch(/^cluster:/);
    expect(r!.snapshot?.tag).toBe('cluster');
  });

  test('cluster → singleton transition restores native-pin type (no snapshot leak)', () => {
    // Simulate: a 2-member cluster zooms apart into two singletons.
    const registry = [
      { id: 'native', isCustom: false },
      { id: 'custom', isCustom: true },
    ];
    const before = resolveCluster(makeInput(2, ['native', 'custom'], registry));
    expect(before!.isCluster).toBe(true);

    const afterNative = resolveCluster(makeInput(1, ['native'], registry));
    expect(afterNative!.marker.id).toBe('native');
    expect(afterNative!.snapshot).toBeUndefined();

    const afterCustom = resolveCluster(makeInput(1, ['custom'], registry));
    expect(afterCustom!.marker.id).toBe('custom');
    expect(afterCustom!.snapshot?.tag).toBe('original');
  });

  test('multi-cluster never references original-marker snapshot', () => {
    const input = makeInput(
      2,
      ['m1', 'm2'],
      [
        { id: 'm1', isCustom: true },
        { id: 'm2', isCustom: true },
      ],
    );
    const r = resolveCluster(input);
    expect(r!.snapshot!.tag).toBe('cluster');
    expect(r!.snapshot!.id).not.toBe('m1');
    expect(r!.snapshot!.id).not.toBe('m2');
  });
});
