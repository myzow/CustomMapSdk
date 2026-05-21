import { forwardRef } from 'react';
import type { AdvancedMarkerMethods, AdvancedMarkerProps } from './types';

/**
 * <AdvancedMarker>
 * ----------------
 * Google Maps Advanced Marker component (cross-platform).
 *
 * Behavior:
 *   - If children (ReactNode) are supplied → renders a CUSTOM advanced marker.
 *     The children tree is attached as the native `iconView` directly (Android
 *     `AdvancedMarkerOptions.iconView(...)`, iOS `GMSAdvancedMarker.iconView`),
 *     so View/Image/Lottie/animated content displays natively rather than as a
 *     static bitmap snapshot.
 *   - If NO children are supplied → renders a DEFAULT advanced marker (a
 *     standard Google Maps pin honoring `pinColor`, `title`, `description`).
 *
 * Clustering:
 *   - Fully participates in the existing `clusterConfig` pipeline on the
 *     parent `<MapView>`. Native clustering uses `ClusterManager<AdvancedMarkerOptions>`
 *     on Android and `GMUClusterManager` + custom advanced-marker renderer on iOS.
 *
 * Requirements:
 *   - Android: Google Maps Android SDK 18.2.0+ with a valid `mapId`
 *     (the SDK defaults to "DEMO_MAP_ID" which is suitable for development).
 *   - iOS: Google Maps iOS SDK 9.0+ on iOS 14+ with a valid `mapID`.
 *
 * This component is a virtual node — it never renders anything in the React
 * tree. The parent `<MapView>` walks its children, collects the props, and
 * forwards them to the native side. Children supplied to <AdvancedMarker>
 * are rendered into an off-screen native container and attached as the
 * marker's iconView.
 */
const AdvancedMarker = forwardRef<AdvancedMarkerMethods, AdvancedMarkerProps>(
  function AdvancedMarker(_props, _ref) {
    return null;
  },
);

AdvancedMarker.displayName = 'RNCustomMapAdvancedMarker';

export default AdvancedMarker;
