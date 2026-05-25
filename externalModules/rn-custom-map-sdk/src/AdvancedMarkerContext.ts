import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { AdvancedMarkerProps } from './types';

/**
 * Entry shape stored in the registry for each mounted
 * {@link AdvancedMarker}. The MapView reads from this registry when
 * building the native marker list, the overlay layer, the bitmap
 * snapshot subtree, and the press-handler maps — making
 * `<AdvancedMarker>` work regardless of how deeply it's nested under
 * the parent `<MapView>`.
 */
export type AdvancedMarkerRegistration = {
  id: string;
  props: AdvancedMarkerProps;
  children: ReactNode;
};

/**
 * Context exposed by `<MapView>` to its descendants. Any
 * `<AdvancedMarker>` mounted in the subtree — directly, or wrapped
 * inside any number of consumer-defined components, fragments,
 * conditional renders, etc. — registers itself here and is picked up
 * by the parent map.
 *
 * The map merges entries from this registry with the inline
 * `parseChildren` extraction so both patterns work simultaneously:
 *
 * <pre>
 *   // Pattern A — inline children
 *   <MapView>
 *     <AdvancedMarker coordinate={...}>
 *       <Avatar />
 *     </AdvancedMarker>
 *   </MapView>
 *
 *   // Pattern B — wrapped in a custom component
 *   <MapView>
 *     {users.map(u => <MyDriverPin user={u} />)}
 *   </MapView>
 *
 *   // where MyDriverPin internally returns:
 *   //   <AdvancedMarker coordinate={user.coords}><Avatar/></AdvancedMarker>
 * </pre>
 */
export type MapContextValue = {
  /**
   * Upsert (insert or replace) the marker entry for {@code id}. Called
   * by {@link AdvancedMarker} from a {@code useEffect} keyed on the
   * primitive prop fields, so we don't thrash on every parent render.
   */
  upsertAdvancedMarker(id: string, entry: AdvancedMarkerRegistration): void;
  /** Remove the entry for {@code id}. Called on unmount. */
  removeAdvancedMarker(id: string): void;
};

export const MapContext = createContext<MapContextValue | null>(null);
