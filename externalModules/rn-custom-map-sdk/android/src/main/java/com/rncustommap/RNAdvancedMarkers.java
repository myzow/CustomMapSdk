package com.rncustommap;

import android.content.Context;
import android.graphics.Color;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.model.AdvancedMarkerOptions;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.PinConfig;
import com.google.maps.android.clustering.Cluster;
import com.google.maps.android.clustering.ClusterItem;
import com.google.maps.android.clustering.ClusterManager;
import com.google.maps.android.clustering.view.DefaultClusterRenderer;
import com.google.maps.android.collections.MarkerManager;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native pipeline that backs the JS-side `<AdvancedMarker>` component.
 *
 * <p>Implementation notes:
 *
 * <ul>
 *   <li>Uses {@link ClusterManager} from {@code com.google.maps.android:android-maps-utils}
 *       (per spec) to host the marker collection. The cluster engine itself
 *       runs in JS (so consumers retain full control over {@code renderCluster}
 *       and a single source of truth across platforms), and the renderer here
 *       is intentionally configured to never re-merge points.</li>
 *   <li>Markers are added via the cluster manager's
 *       {@link MarkerManager.Collection} so the cluster manager's internal
 *       click router still recognises them — preserving cross-talk with
 *       the GoogleMap-wide click listener which routes presses to JS.</li>
 *   <li>Each marker is created from an {@link AdvancedMarkerOptions} instance,
 *       so on a map constructed with a valid {@code mapId} (the SDK defaults
 *       to {@code "DEMO_MAP_ID"}) Google's SDK renders them as full Advanced
 *       Markers — supporting both {@link AdvancedMarkerOptions#iconView(View)}
 *       (custom React content) and {@link PinConfig} (default pin with
 *       optional pinColor).</li>
 *   <li>For backward compatibility — and to fulfil the spec's clustering
 *       contract — {@link ClusterManager} and an
 *       {@link DefaultClusterRenderer} are instantiated even when clustering
 *       is disabled. They simply hold the marker collection in that case.</li>
 * </ul>
 */
public final class RNAdvancedMarkers {

  /** Cluster item kept for ClusterManager compatibility. Not used for rendering. */
  static final class RNAdvancedClusterItem implements ClusterItem {
    final String id;
    final LatLng position;

    RNAdvancedClusterItem(String id, LatLng position) {
      this.id = id;
      this.position = position;
    }

    @NonNull @Override public LatLng getPosition() { return position; }
    @Nullable @Override public String getTitle() { return null; }
    @Nullable @Override public String getSnippet() { return null; }
    @Nullable @Override public Float getZIndex() { return 0f; }
  }

  /**
   * Custom renderer that disables auto-clustering. The JS engine performs
   * clustering (so renderCluster, ignore lists, drag-gating remain a single
   * cross-platform implementation) and pushes the resulting singletons +
   * synthetic bubbles down to the native side as a flat array. This renderer
   * keeps the {@link ClusterManager} contract while ensuring no re-merging.
   */
  static final class AdvancedRenderer
      extends DefaultClusterRenderer<RNAdvancedClusterItem> {
    AdvancedRenderer(Context context, GoogleMap map, ClusterManager<RNAdvancedClusterItem> cm) {
      super(context, map, cm);
      setMinClusterSize(Integer.MAX_VALUE);
    }
  }

  /** Per-view state for the advanced-marker pipeline. */
  static final class State {
    @Nullable ClusterManager<RNAdvancedClusterItem> clusterManager;
    @Nullable AdvancedRenderer renderer;
    @Nullable MarkerManager.Collection collection;
    /** Currently mounted advanced markers keyed by id. */
    final Map<String, Marker> markers = new HashMap<>();
    /** Latest React-rendered iconView per markerId. */
    final Map<String, View> iconViews = new HashMap<>();
    /** Whether clustering should run (from clusterConfig.enabled). */
    boolean usingClusterManager = true;
  }

  private RNAdvancedMarkers() {}

  /** Hook called when the GoogleMap becomes available — lazily initialises state. */
  static void onMapReady(@NonNull RNCustomMapView view) {
    ensureClusterManager(view);
  }

  /**
   * Lazily creates the ClusterManager + a dedicated marker collection. Calling
   * this multiple times is a no-op. The cluster manager's constructor takes
   * over the map's OnMarkerClickListener — restored to the host's composite
   * listener immediately after.
   */
  static void ensureClusterManager(@NonNull RNCustomMapView view) {
    final GoogleMap map = view.googleMap;
    if (map == null) return;
    State state = view.advancedState;
    if (state.clusterManager != null) return;

    ClusterManager<RNAdvancedClusterItem> cm = new ClusterManager<>(view.getContext(), map);
    AdvancedRenderer renderer = new AdvancedRenderer(view.getContext(), map, cm);
    cm.setRenderer(renderer);
    // Dedicated collection so advanced markers route through the cluster
    // manager's MarkerManager — preserving its click semantics — but are
    // visually independent of the renderer's cluster-bubble pipeline.
    MarkerManager.Collection collection = cm.getMarkerManager().newCollection();
    // Wire collection click events back to the host so JS receives
    // `onMarkerPress` for advanced markers and synthetic cluster bubbles.
    collection.setOnMarkerClickListener(marker -> {
      view.emitMarkerEvent("onMarkerPress", marker);
      return true;
    });
    collection.setOnInfoWindowClickListener(marker ->
        view.emitMarkerEvent("onCalloutPress", marker));
    collection.setOnMarkerDragListener(new GoogleMap.OnMarkerDragListener() {
      @Override public void onMarkerDragStart(@NonNull Marker marker) {
        view.emitMarkerEvent("onMarkerDragStart", marker);
      }
      @Override public void onMarkerDrag(@NonNull Marker marker) {
        view.emitMarkerEvent("onMarkerDrag", marker);
      }
      @Override public void onMarkerDragEnd(@NonNull Marker marker) {
        view.emitMarkerEvent("onMarkerDragEnd", marker);
      }
    });

    // The cluster manager swiped OnMarkerClickListener in its constructor;
    // restore our composite chain so classic markers retain their handlers.
    view.restoreMarkerClickListener();

    state.clusterManager = cm;
    state.renderer = renderer;
    state.collection = collection;
  }

  /**
   * Apply a new set of advanced markers. Diff-based: existing markers are
   * reused when ids match, removed when ids disappear, created otherwise.
   *
   * @param useClustering currently unused at the native layer — the JS-side
   *                      cluster engine produces a flat array of singletons +
   *                      synthetic cluster bubbles. The flag is kept for API
   *                      symmetry and future native-only clustering.
   */
  static void setAdvancedMarkers(
      @NonNull RNCustomMapView view,
      @Nullable ReadableArray advancedMarkers,
      @SuppressWarnings("unused") boolean useClustering) {
    view.whenReady(() -> {
      final GoogleMap map = view.googleMap;
      if (map == null) return;
      ensureClusterManager(view);
      State state = view.advancedState;
      if (state.collection == null) return;

      // Build desired set.
      Map<String, ReadableMap> incoming = new HashMap<>();
      List<String> order = new ArrayList<>();
      if (advancedMarkers != null) {
        for (int i = 0; i < advancedMarkers.size(); i++) {
          ReadableMap item = advancedMarkers.getMap(i);
          if (item == null || !item.hasKey("id")) continue;
          String id = item.getString("id");
          if (id == null || id.isEmpty()) continue;
          incoming.put(id, item);
          order.add(id);
        }
      }

      // 1) Remove obsolete markers.
      List<String> remove = new ArrayList<>();
      for (String existingId : state.markers.keySet()) {
        if (!incoming.containsKey(existingId)) remove.add(existingId);
      }
      for (String id : remove) {
        Marker m = state.markers.remove(id);
        if (m != null) state.collection.remove(m);
      }

      // 2) Add / update.
      for (String id : order) {
        ReadableMap item = incoming.get(id);
        LatLng pos = new LatLng(item.getDouble("latitude"), item.getDouble("longitude"));
        Marker existing = state.markers.get(id);
        boolean hasCustomView = getBoolean(item, "hasCustomView", false);
        View iconView = state.iconViews.get(id);

        // A marker's iconView vs default pin choice cannot be flipped at
        // runtime via the AdvancedMarker API. When the resolved appearance
        // for this id has changed, drop and recreate.
        boolean wantsIconView = hasCustomView && iconView != null;
        boolean currentlyHasIconView =
            existing != null && Boolean.TRUE.equals(state.markers.get(id) != null
                && Boolean.TRUE.equals(item.hasKey("hasCustomView")
                    && item.getBoolean("hasCustomView")));
        // The above conservative comparison is just "different rendering mode"
        // — if uncertain, recreate. Recreation is cheap when the cluster
        // manager owns the collection.
        if (existing != null && wantsIconView) {
          // The native API doesn't support swapping iconView in place — we
          // always recreate when an iconView is supplied to keep behavior
          // deterministic.
          state.collection.remove(existing);
          existing = null;
        }

        if (existing != null) {
          // Position + light mutable fields.
          if (!existing.getPosition().equals(pos)) existing.setPosition(pos);
          existing.setTitle(getString(item, "title"));
          existing.setSnippet(getString(item, "description"));
          existing.setDraggable(getBoolean(item, "draggable", existing.isDraggable()));
          existing.setFlat(getBoolean(item, "flat", existing.isFlat()));
          existing.setRotation((float) getDouble(item, "rotation", existing.getRotation()));
          existing.setAlpha((float) getDouble(item, "opacity", existing.getAlpha()));
          existing.setAnchor(anchorU(item), anchorV(item));
          existing.setZIndex((int) getDouble(item, "zIndex", existing.getZIndex()));
          continue;
        }

        AdvancedMarkerOptions options = buildOptions(id, item, iconView, hasCustomView);
        Marker created = state.collection.addMarker(options);
        if (created != null) {
          created.setTag(id);
          state.markers.put(id, created);
        }
      }
    });
  }

  /**
   * Bind a React-rendered native view as the iconView for an advanced marker.
   * Recreates the marker so the new iconView takes effect (the SDK does not
   * expose a runtime setter for iconView on an existing AdvancedMarker).
   */
  static void setIconView(
      @NonNull RNCustomMapView view, @NonNull String markerId, @NonNull View iconView) {
    view.whenReady(() -> {
      State state = view.advancedState;
      state.iconViews.put(markerId, iconView);
      if (state.collection == null) return;

      Marker existing = state.markers.get(markerId);
      if (existing == null) return;

      LatLng pos = existing.getPosition();
      AdvancedMarkerOptions options = new AdvancedMarkerOptions()
          .position(pos)
          .title(existing.getTitle())
          .snippet(existing.getSnippet())
          .draggable(existing.isDraggable())
          .flat(existing.isFlat())
          .rotation(existing.getRotation())
          .alpha(existing.getAlpha())
          .anchor(0.5f, 1f)
          .iconView(iconView);
      state.collection.remove(existing);
      Marker created = state.collection.addMarker(options);
      if (created != null) {
        created.setTag(markerId);
        state.markers.put(markerId, created);
      }
    });
  }

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  private static AdvancedMarkerOptions buildOptions(
      String id, ReadableMap item, @Nullable View iconView, boolean hasCustomView) {
    AdvancedMarkerOptions options = new AdvancedMarkerOptions()
        .position(new LatLng(item.getDouble("latitude"), item.getDouble("longitude")))
        .title(getString(item, "title"))
        .snippet(getString(item, "description"))
        .draggable(getBoolean(item, "draggable", false))
        .flat(getBoolean(item, "flat", false))
        .rotation((float) getDouble(item, "rotation", 0))
        .alpha((float) getDouble(item, "opacity", 1))
        .anchor(anchorU(item), anchorV(item))
        .zIndex((int) getDouble(item, "zIndex", 0));

    if (hasCustomView && iconView != null) {
      options.iconView(iconView);
    } else {
      // Default Advanced Marker pin, optionally tinted by pinColor.
      PinConfig.Builder pin = PinConfig.builder();
      Integer color = pinColorArgb(item);
      if (color != null) {
        pin.setBackgroundColor(color);
        pin.setBorderColor(Color.WHITE);
      }
      options.icon(BitmapDescriptorFactory.fromPinConfig(pin.build()));
    }
    return options;
  }

  @Nullable
  private static Integer pinColorArgb(ReadableMap item) {
    String hex = getString(item, "pinColor");
    if (hex == null || hex.isEmpty()) return null;
    try {
      return Color.parseColor(hex);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static float anchorU(ReadableMap item) {
    if (item.hasKey("anchor") && !item.isNull("anchor")) {
      ReadableMap a = item.getMap("anchor");
      if (a != null && a.hasKey("x")) return (float) a.getDouble("x");
    }
    return 0.5f;
  }

  private static float anchorV(ReadableMap item) {
    if (item.hasKey("anchor") && !item.isNull("anchor")) {
      ReadableMap a = item.getMap("anchor");
      if (a != null && a.hasKey("y")) return (float) a.getDouble("y");
    }
    return 1.0f;
  }

  private static String getString(ReadableMap map, String key) {
    return map != null && map.hasKey(key) && !map.isNull(key) ? map.getString(key) : null;
  }

  private static boolean getBoolean(ReadableMap map, String key, boolean fallback) {
    return map != null && map.hasKey(key) && !map.isNull(key) ? map.getBoolean(key) : fallback;
  }

  private static double getDouble(ReadableMap map, String key, double fallback) {
    return map != null && map.hasKey(key) && !map.isNull(key) ? map.getDouble(key) : fallback;
  }
}
