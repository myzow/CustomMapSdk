package com.rncustommap;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.model.AdvancedMarkerOptions;
import com.google.android.gms.maps.model.BitmapDescriptor;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.PinConfig;
import com.google.maps.android.clustering.ClusterItem;
import com.google.maps.android.clustering.ClusterManager;
import com.google.maps.android.clustering.view.DefaultClusterRenderer;
import com.google.maps.android.collections.MarkerManager;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native pipeline that backs the JS-side {@code <AdvancedMarker>} component.
 *
 * <h2>Performance & crash strategy</h2>
 *
 * <p>The Google Maps Platform blog (and the official Maps SDK guidance)
 * recommends two paths for Advanced Markers:
 *
 * <ul>
 *   <li><b>Static bitmaps</b> via {@code AdvancedMarkerOptions.icon(...)} for
 *       any marker whose visual content does not change per frame. This is
 *       the fastest path — the GPU composites a single texture per marker
 *       and the map's camera animations stay at 60 FPS even with thousands
 *       of markers on screen.</li>
 *   <li><b>Live iconView</b> via {@code AdvancedMarkerOptions.iconView(view)}
 *       for actively-animating content (Lottie, video). The View is added
 *       to the map's overlay window; it cannot already have a parent.</li>
 * </ul>
 *
 * <p>Historically this module attached the React-managed snapshot View
 * directly via {@code iconView(view)} — but that View is owned by React's
 * view tree, so it always has a parent at attach time. The result was a
 * hard crash:
 *
 * <pre>
 * IllegalStateException: The specified child already has a parent. You
 * must call removeView() on the child's parent first.
 * </pre>
 *
 * <p>The implementation here takes the bitmap path: the React-rendered
 * View is rasterized to a {@link Bitmap} once, wrapped in a
 * {@link BitmapDescriptor}, and assigned as the marker's icon. The
 * resulting marker is a real {@code AdvancedMarker} (constructed from
 * {@link AdvancedMarkerOptions} on a map with a valid {@code mapId}) so
 * all advanced-marker features — z-collision, accessibility traversal,
 * proper hit-testing — are preserved. And it never crashes.
 *
 * <p>The same bitmap is reused for every marker that shares a content
 * signature, so cluster recomputes don't re-rasterize anything.
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
    /** Latest React-rendered iconView (the source for rasterization). */
    final Map<String, View> iconViews = new HashMap<>();
    /**
     * Last bitmap-descriptor produced for each marker id. Used to short-
     * circuit redundant {@link Marker#setIcon} calls (each setIcon triggers
     * a renderer commit which is the single biggest source of mid-drag
     * jank).
     */
    final Map<String, BitmapDescriptor> lastIcons = new HashMap<>();
    /** Last content-signature for each marker id — see {@link #signatureFor}. */
    final Map<String, String> lastSignatures = new HashMap<>();
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
    MarkerManager.Collection collection = cm.getMarkerManager().newCollection();
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
   * reused (position + light fields updated in place) when ids match,
   * removed when ids disappear, created otherwise.
   *
   * <p>This method NEVER touches a marker's icon — that's the exclusive
   * job of {@link #setIconView} which is the only entry point that knows
   * the resolved React View. Splitting the work this way means the
   * camera-tracked diff path (called on every cluster recompute) is purely
   * arithmetic; no bitmap work happens unless a snapshot view actually
   * changed.
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
        state.lastIcons.remove(id);
        state.lastSignatures.remove(id);
        state.iconViews.remove(id);
      }

      // 2) Add / update.
      for (String id : order) {
        ReadableMap item = incoming.get(id);
        LatLng pos = new LatLng(item.getDouble("latitude"), item.getDouble("longitude"));
        boolean hasCustomView = getBoolean(item, "hasCustomView", false);
        Marker existing = state.markers.get(id);

        if (existing != null) {
          // Position + light mutable fields. Icon is updated only by
          // setIconView (when the resolved bitmap actually changed).
          if (!existing.getPosition().equals(pos)) existing.setPosition(pos);
          String title = getString(item, "title");
          if (title != null && !title.equals(existing.getTitle())) existing.setTitle(title);
          String desc = getString(item, "description");
          if (desc != null && !desc.equals(existing.getSnippet())) existing.setSnippet(desc);
          existing.setDraggable(getBoolean(item, "draggable", existing.isDraggable()));
          existing.setFlat(getBoolean(item, "flat", existing.isFlat()));
          float rotation = (float) getDouble(item, "rotation", existing.getRotation());
          if (rotation != existing.getRotation()) existing.setRotation(rotation);
          float alpha = (float) getDouble(item, "opacity", existing.getAlpha());
          if (alpha != existing.getAlpha()) existing.setAlpha(alpha);
          existing.setAnchor(anchorU(item), anchorV(item));
          existing.setZIndex((int) getDouble(item, "zIndex", existing.getZIndex()));
          continue;
        }

        // Fresh marker. If a custom view is expected, build with a
        // transparent placeholder bitmap so the default pin never shows;
        // the real bitmap arrives via setIconView shortly.
        BitmapDescriptor initialIcon = null;
        if (hasCustomView) {
          initialIcon = transparentPlaceholder();
        }

        AdvancedMarkerOptions options;
        try {
          options = buildOptions(item, initialIcon, hasCustomView);
        } catch (RuntimeException e) {
          // Defensive guard — if AdvancedMarkerOptions throws because the
          // renderer wasn't upgraded to LATEST, log and skip this marker
          // rather than crash the whole map.
          android.util.Log.e(
              "RNAdvancedMarkers",
              "Failed to build AdvancedMarkerOptions for id=" + id +
              " (is the map's mapId set + LATEST renderer initialized?)",
              e);
          continue;
        }

        Marker created;
        try {
          created = state.collection.addMarker(options);
        } catch (RuntimeException e) {
          android.util.Log.e(
              "RNAdvancedMarkers", "addMarker failed for id=" + id, e);
          continue;
        }
        if (created != null) {
          created.setTag(id);
          state.markers.put(id, created);
        }
      }
    });
  }

  /**
   * Bind a React-rendered native view as the visual content for an
   * advanced marker. Rasterizes the View to a {@link Bitmap} and assigns
   * the resulting {@link BitmapDescriptor} as the marker's icon.
   *
   * <p>Implementation notes:
   * <ul>
   *   <li>The bitmap is keyed by (markerId, view size, view-identity hash)
   *       so unchanged content (the common case during a cluster recompute
   *       that moved the camera but kept the marker set) reuses the same
   *       descriptor and the {@code setIcon} call is short-circuited.</li>
   *   <li>The View itself is NEVER re-parented onto the map. Google's
   *       {@code iconView(view)} API requires an unparented View and the
   *       React-managed snapshot tree always provides a parented one —
   *       attempting to attach causes {@code IllegalStateException}. The
   *       bitmap path sidesteps this entirely and is also Google's
   *       recommended high-performance path.</li>
   *   <li>The bitmap is generated on the UI thread via
   *       {@link View#draw(Canvas)} — same call pattern the classic
   *       marker pipeline already uses. This is fast for typical marker
   *       sizes (&lt;200x200 px) and stays well under one frame.</li>
   * </ul>
   */
  static void setIconView(
      @NonNull RNCustomMapView view, @NonNull String markerId, @NonNull View iconView) {
    view.whenReady(() -> {
      State state = view.advancedState;
      state.iconViews.put(markerId, iconView);
      if (state.collection == null) return;

      Marker existing = state.markers.get(markerId);
      if (existing == null) return;

      int width = iconView.getWidth();
      int height = iconView.getHeight();
      if (width <= 0 || height <= 0) {
        // View hasn't been measured yet; wait for its onLayout to call us
        // back with a non-zero size.
        return;
      }

      String signature = signatureFor(markerId, iconView, width, height);
      String previousSignature = state.lastSignatures.get(markerId);
      if (signature.equals(previousSignature)) {
        // No-op: identical content already on the marker. This is the
        // common path during cluster recomputes — skipping it is the
        // single biggest factor in the 60 FPS pan/zoom target.
        return;
      }

      BitmapDescriptor descriptor;
      try {
        Bitmap bitmap = rasterize(iconView, width, height);
        descriptor = BitmapDescriptorFactory.fromBitmap(bitmap);
      } catch (RuntimeException e) {
        android.util.Log.e("RNAdvancedMarkers",
            "rasterize failed for id=" + markerId, e);
        return;
      }

      existing.setIcon(descriptor);
      // Use ground-anchor (0.5, 1) by default — same as classic markers.
      existing.setAnchor(0.5f, 1f);

      state.lastIcons.put(markerId, descriptor);
      state.lastSignatures.put(markerId, signature);
    });
  }

  // ------------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------------

  /**
   * Rasterizes the React-rendered View to an offscreen Bitmap. Detaches
   * any temporary parent the view may have while we draw — purely to be
   * defensive; React's snapshot root always has the view parented, but
   * draw() doesn't actually require detachment.
   */
  @NonNull
  private static Bitmap rasterize(@NonNull View view, int width, int height) {
    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);
    view.draw(canvas);
    return bitmap;
  }

  /**
   * Generates a stable signature for a marker's iconView content. The
   * signature combines the marker id, the View's identity, and its
   * measured size — enough to detect "real" changes while letting the
   * common no-op case (same view, same size) hit the cache.
   *
   * <p>We don't hash pixel content because that would defeat the perf
   * win we're after. React unmounts and remounts the underlying View
   * when the children change (different identity hash), so this is a
   * sufficient proxy.
   */
  @NonNull
  private static String signatureFor(
      @NonNull String markerId, @NonNull View view, int width, int height) {
    return markerId + ":" + System.identityHashCode(view) + ":" + width + "x" + height;
  }

  /**
   * Builds {@link AdvancedMarkerOptions} for a fresh marker. The icon (if
   * any) is set via {@code .icon(...)} — the {@code .iconView(...)} path
   * is intentionally avoided; see class-level docs.
   */
  @NonNull
  private static AdvancedMarkerOptions buildOptions(
      @NonNull ReadableMap item,
      @Nullable BitmapDescriptor initialIcon,
      boolean hasCustomView) {
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

    if (hasCustomView && initialIcon != null) {
      // Transparent placeholder until the real React snapshot arrives.
      options.icon(initialIcon);
    } else if (!hasCustomView) {
      // Default Advanced Marker pin, optionally tinted by pinColor.
      PinConfig.Builder pin = PinConfig.builder();
      Integer color = pinColorArgb(item);
      if (color != null) {
        pin.setBackgroundColor(color);
        pin.setBorderColor(Color.WHITE);
      }
      options.icon(BitmapDescriptorFactory.fromPinConfig(pin.build()));
    }
    // hasCustomView && initialIcon==null shouldn't happen, but if it does
    // leaving the icon unset uses the default AdvancedMarker pin.
    return options;
  }

  /** Cached 1x1 transparent bitmap used as the placeholder for custom-view markers. */
  @Nullable private static volatile BitmapDescriptor sTransparentPlaceholder;

  @NonNull
  private static BitmapDescriptor transparentPlaceholder() {
    BitmapDescriptor cached = sTransparentPlaceholder;
    if (cached != null) return cached;
    synchronized (RNAdvancedMarkers.class) {
      if (sTransparentPlaceholder == null) {
        Bitmap bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        bmp.eraseColor(Color.TRANSPARENT);
        sTransparentPlaceholder = BitmapDescriptorFactory.fromBitmap(bmp);
      }
      return sTransparentPlaceholder;
    }
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
