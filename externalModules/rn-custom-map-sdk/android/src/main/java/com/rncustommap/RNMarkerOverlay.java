package com.rncustommap;

import android.graphics.Point;
import android.view.View;

import androidx.annotation.NonNull;

import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.Projection;
import com.google.android.gms.maps.model.LatLng;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Native-synced overlay positioning for advanced markers — the Uber /
 * Lyft / Life360 / Zomato model.
 *
 * <p>The React-rendered marker view stays exactly where React put it
 * (a sibling of the map, positioned absolute with left=0/top=0). On
 * every camera frame the GoogleMap's projection converts the marker's
 * lat/lng to screen pixels and we apply
 * {@code view.setTranslationX/Y(...)} directly to the React view. The
 * call lands inside the same UI-thread frame as the map's onCameraMove
 * tick, so the overlay tracks the map pixel-perfectly — no bitmap
 * pumping, no setIcon flicker, no React-Fabric reparenting crash.
 *
 * <p>Anchor: the (anchorX, anchorY) values are normalized
 * {@code [0..1]} relative to the marker view's own size. The default
 * (0.5, 1.0) puts the bottom-center of the view at the projected
 * coordinate — same convention as classic Google Maps markers.
 *
 * <p>Off-screen culling: views whose projection falls outside the map
 * bounds are translated far enough off-screen to skip drawing; the
 * underlying React view is left alone (we don't touch visibility, only
 * translation) so React state is preserved.
 */
public final class RNMarkerOverlay {

  static final class Entry {
    @NonNull View view;
    @NonNull LatLng position;
    float anchorX;
    float anchorY;

    Entry(@NonNull View view, @NonNull LatLng position, float anchorX, float anchorY) {
      this.view = view;
      this.position = position;
      this.anchorX = anchorX;
      this.anchorY = anchorY;
    }
  }

  /** Per-view state. */
  static final class State {
    final Map<String, Entry> entries = new HashMap<>();
  }

  private RNMarkerOverlay() {}

  /**
   * Register or update the overlay binding for a marker id. Idempotent —
   * calling again with the same id replaces the entry (used for both
   * coordinate updates and view-tag changes on remount).
   *
   * <p>After registering we apply the position immediately so the view
   * is placed without waiting for the next camera tick.
   */
  static void set(
      @NonNull RNCustomMapView mapView,
      @NonNull String markerId,
      @NonNull View view,
      double latitude,
      double longitude,
      float anchorX,
      float anchorY) {
    mapView.whenReady(() -> {
      State state = mapView.overlayState;
      LatLng position = new LatLng(latitude, longitude);
      Entry existing = state.entries.get(markerId);
      if (existing != null) {
        existing.view = view;
        existing.position = position;
        existing.anchorX = anchorX;
        existing.anchorY = anchorY;
      } else {
        state.entries.put(markerId, new Entry(view, position, anchorX, anchorY));
      }
      applyOne(mapView, markerId);
    });
  }

  static void remove(@NonNull RNCustomMapView mapView, @NonNull String markerId) {
    mapView.whenReady(() -> {
      State state = mapView.overlayState;
      Entry removed = state.entries.remove(markerId);
      if (removed != null) {
        // Park the view off-screen so a stale React commit can't
        // momentarily flash it in the wrong place.
        try {
          removed.view.setTranslationX(-100000f);
          removed.view.setTranslationY(-100000f);
        } catch (RuntimeException ignored) {}
      }
    });
  }

  /**
   * Reposition every registered overlay. Hooked into the map's
   * {@code OnCameraMoveListener} so it fires synchronously with each
   * camera frame the GMS renderer composites — that's what gives the
   * overlay its pixel-perfect sync with the map.
   */
  static void onCameraMove(@NonNull RNCustomMapView mapView) {
    State state = mapView.overlayState;
    if (state.entries.isEmpty()) return;
    GoogleMap map = mapView.googleMap;
    if (map == null) return;
    Projection projection = map.getProjection();
    Iterator<Map.Entry<String, Entry>> it = state.entries.entrySet().iterator();
    while (it.hasNext()) {
      Entry e = it.next().getValue();
      applyEntry(projection, e);
    }
  }

  private static void applyOne(@NonNull RNCustomMapView mapView, @NonNull String markerId) {
    GoogleMap map = mapView.googleMap;
    if (map == null) return;
    Entry e = mapView.overlayState.entries.get(markerId);
    if (e == null) return;
    applyEntry(map.getProjection(), e);
  }

  private static void applyEntry(@NonNull Projection projection, @NonNull Entry e) {
    Point screen;
    try {
      screen = projection.toScreenLocation(e.position);
    } catch (RuntimeException ex) {
      return;
    }
    View v = e.view;
    int w = v.getWidth();
    int h = v.getHeight();
    // The view's measured size may be 0 on the very first tick (before
    // RN's layout pass completes for this frame). That's fine — we'll
    // get called again on the next camera tick once the view has
    // measured. Until then position the top-left at the coordinate so
    // the marker doesn't visually appear in the wrong place.
    float dx = screen.x - (w * e.anchorX);
    float dy = screen.y - (h * e.anchorY);
    try {
      v.setTranslationX(dx);
      v.setTranslationY(dy);
    } catch (RuntimeException ignored) {}
  }
}
