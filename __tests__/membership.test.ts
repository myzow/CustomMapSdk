/**
 * @format
 */

import {
  clusterSignature,
  stableClusterKey,
  diffMembership,
} from '../externalModules/rn-custom-map-sdk/src/clustering/membership';

describe('clusterSignature', () => {
  test('singleton uses the first member id', () => {
    expect(
      clusterSignature({ id: 'single:m1', pointCount: 1, markerIds: ['m1'] }),
    ).toBe('s:m1');
  });

  test('falls back to cluster id when singleton has no markers', () => {
    expect(
      clusterSignature({ id: 'fallback', pointCount: 1, markerIds: [] }),
    ).toBe('s:fallback');
  });

  test('multi-cluster signature is independent of input order', () => {
    const a = clusterSignature({
      id: 'g:1',
      pointCount: 3,
      markerIds: ['c', 'a', 'b'],
    });
    const b = clusterSignature({
      id: 'g:1',
      pointCount: 3,
      markerIds: ['a', 'b', 'c'],
    });
    expect(a).toBe(b);
    expect(a).toBe('m:a|b|c');
  });

  test('changes when membership changes', () => {
    expect(
      clusterSignature({ id: 'g:1', pointCount: 2, markerIds: ['a', 'b'] }),
    ).not.toBe(
      clusterSignature({ id: 'g:1', pointCount: 2, markerIds: ['a', 'c'] }),
    );
  });
});

describe('stableClusterKey', () => {
  test('combines cluster id + signature', () => {
    expect(
      stableClusterKey({ id: 'g:0:0', pointCount: 1, markerIds: ['m1'] }),
    ).toBe('g:0:0|s:m1');
  });

  test('same members in same cell → same key', () => {
    const a = stableClusterKey({
      id: 'g:1:2',
      pointCount: 2,
      markerIds: ['a', 'b'],
    });
    const b = stableClusterKey({
      id: 'g:1:2',
      pointCount: 2,
      markerIds: ['b', 'a'],
    });
    expect(a).toBe(b);
  });

  test('same members in different cells → different keys (correct: bubble moved)', () => {
    expect(
      stableClusterKey({ id: 'g:1:2', pointCount: 2, markerIds: ['a', 'b'] }),
    ).not.toBe(
      stableClusterKey({ id: 'g:3:4', pointCount: 2, markerIds: ['a', 'b'] }),
    );
  });
});

describe('diffMembership', () => {
  test('first pass → everything added, nothing removed', () => {
    const cur = [
      { id: 'g:1', pointCount: 1, markerIds: ['a'] },
      { id: 'g:2', pointCount: 2, markerIds: ['b', 'c'] },
    ];
    const diff = diffMembership(undefined, cur);
    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toEqual([]);
    expect(diff.kept).toEqual([]);
  });

  test('identical pass → everything kept', () => {
    const prev = [
      { id: 'g:1', pointCount: 1, markerIds: ['a'] },
      { id: 'g:2', pointCount: 2, markerIds: ['b', 'c'] },
    ];
    const diff = diffMembership(prev, prev);
    expect(diff.kept).toHaveLength(2);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test('member moves into a cluster → that cluster is added and the singleton removed', () => {
    const prev = [
      { id: 'g:1', pointCount: 1, markerIds: ['a'] },
      { id: 'g:2', pointCount: 1, markerIds: ['b'] },
    ];
    const cur = [{ id: 'g:1', pointCount: 2, markerIds: ['a', 'b'] }];
    const diff = diffMembership(prev, cur);
    expect(diff.added.map(c => c.id)).toEqual(['g:1']);
    expect(diff.removed.sort()).toEqual(
      ['g:1|s:a', 'g:2|s:b'].sort(),
    );
    expect(diff.kept).toEqual([]);
  });

  test('member-order shuffling alone does NOT register as a change', () => {
    const prev = [{ id: 'g:1', pointCount: 2, markerIds: ['a', 'b'] }];
    const cur = [{ id: 'g:1', pointCount: 2, markerIds: ['b', 'a'] }];
    const diff = diffMembership(prev, cur);
    expect(diff.kept).toHaveLength(1);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});
