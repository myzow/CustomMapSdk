package com.rncustommap;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Native pipeline that backs the JS-side {@code <AdvancedMarker>} component.
 *
 * <h2>Two rendering modes</h2>
 *
 * <ol>
 *   <li><b>Live iconView</b> (default, {@code tracksViewChanges=true}).
 *       The React-rendered View is reparented into an SDK-owned
 *       {@link FrameLayout} wrapper and the wrapper is passed to
 *       {@link AdvancedMarkerOptions#iconView(View)}. The wrapper becomes a
 *       real child of the {@code GoogleMap} overlay container, so any
 *       animation the View runs (Animated.View, Lottie, ActivityIndicator,
 *       Reanimated, rotating image) plays back at native frame rate. This
 *       is the path Uber / Lyft / Life360 / Zomato use for live driver pins,
 *       courier pulses, and breathing destination dots.</li>
 *
 *   <li><b>Static bitmap</b> ({@code tracksViewChanges=false}). The View
 *       is rasterized via {@link View#draw(Canvas)} once per content
 *       signature and the resulting {@link BitmapDescriptor} is reused
 *       across cluster recomputes. This is the highest-FPS path; use it
 *       for dense maps (500+ markers) where the marker's visual content
 *       does not change after first layout.</li>
 * </ol>
 *
 * <h2>Why the wrapper</h2>
 *
 * <p>{@code AdvancedMarkerOptions.iconView(view)} crashes with
 * {@code IllegalStateException} when the supplied View already has a
 * parent. React Native's snapshot tree always parents the rendered view
 * (under the off-screen {@code markerSnapshotRoot}), so we cannot pass
 * React's View directly. Instead we keep a dedicated FrameLayout per
 * marker id, move the React View into it (removing from the snapshot
 * root first), and hand the wrapper to Maps SDK. GMS adds the wrapper
 * to its overlay container; the React View animates inside as a normal
 * child.
 *
 * <p>Edge cases handled:
 * <ul>
 *   <li>React unmounts the snapshot view → JS calls {@link #releaseIconView}
 *       which detaches the React View from our wrapper and clears the
 *       marker's icon. Prevents the "view has been unmounted" crash.</li>
 *   <li>Marker is removed (cluster forms / scrolled off / id disappears)
 *       → {@code removeMarker} cleans the wrapper and clears the iconView
 *       reference.</li>
 *   <li>Content swap (same marker id, new React snapshot view) → wrapper
 *       is repurposed: old child removed, new child added. The
 *       AdvancedMarker itself is reused (its iconView reference is still
 *       the same wrapper instance).</li>
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
   * Custom renderer that disables auto-clustering. JS performs clustering
   * and pushes singletons + synthetic bubbles to the native side; this
   * renderer keeps the {@link ClusterManager} API surface available
   * without re-merging anything.
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
    /** Latest React-rendered iconView reference per marker id. */
    final Map<String, View> iconViews = new HashMap<>();
    /** SDK-owned wrapper that holds the React iconView. One per marker id. */
    final Map<String, FrameLayout> iconWrappers = new HashMap<>();
    /** Marker ids whose AdvancedMarker was constructed with iconView (live mode). */
    final Set<String> liveMarkers = new HashSet<>();
    /** Marker ids using the static-bitmap path. */
    final Set<String> staticMarkers = new HashSet<>();
    /** Whether each marker prefers the live path (from tracksViewChanges). */
    final Map<String, Boolean> tracksChanges = new HashMap<>();
    /** Cached bitmap descriptor per marker id (static path). */
    final Map<String, BitmapDescriptor> lastIcons = new HashMap<>();
    /** Content signature for the static-bitmap cache. */
    final Map<String, String> lastSignatures = new HashMap<>();
    boolean usingClusterManager = true;
  }

  private RNAdvancedMarkers() {}

  static void onMapReady(@NonNull RNCustomMapView view) {
    ensureClusterManager(view);
  }

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

    view.restoreMarkerClickListener();

    state.clusterManager = cm;
    state.renderer = renderer;
    state.collection = collection;
  }

  /**
   * Apply a new set of advanced markers. Diff-based: existing markers
   * are reused (position + light fields updated) when ids match,
   * removed when ids disappear, created otherwise.
   *
   * <p>Icon binding (live iconView or static bitmap) is exclusively the
   * job of {@link #setIconView}. This method never touches a marker's
   * visual content — it only manipulates the marker set membership.
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
        removeMarker(state, id);
      }

      // 2) Add / update.
      for (String id : order) {
        ReadableMap item = incoming.get(id);
        LatLng pos = new LatLng(item.getDouble("latitude"), item.getDouble("longitude"));
        boolean hasCustomView = getBoolean(item, "hasCustomView", false);
        boolean tracksChanges = getBoolean(item, "tracksViewChanges", true);
        state.tracksChanges.put(id, tracksChanges);

        Marker existing = state.markers.get(id);

        if (existing != null) {
          // Reuse: update mutable fields only. Icon binding is handled
          // by setIconView (live) or the bitmap path inside setIconView
          // (static).
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

        // Fresh marker. We always create with a transparent placeholder
        // for custom-view markers — setIconView will swap in the real
        // wrapper / bitmap once the React view has measured.
        BitmapDescriptor initialIcon =
            hasCustomView ? transparentPlaceholder() : null;

        AdvancedMarkerOptions options;
        try {
          options = buildOptions(item, initialIcon, hasCustomView);
        } catch (RuntimeException e) {
          android.util.Log.e(
              "RNAdvancedMarkers",
              "Failed to build AdvancedMarkerOptions for id=" + id, e);
          continue;
        }

        Marker created;
        try {
          created = state.collection.addMarker(options);
        } catch (RuntimeException e) {
          android.util.Log.e("RNAdvancedMarkers", "addMarker failed id=" + id, e);
          continue;
        }
        if (created != null) {
          created.setTag(id);
          state.markers.put(id, created);

          // If a React snapshot view already arrived for this marker
          // (setIconView called before setAdvancedMarkers due to UI-thread
          // queue ordering), apply it now so the user never sees the
          // transparent placeholder.
          View cachedView = state.iconViews.get(id);
          if (hasCustomView && cachedView != null
              && cachedView.getWidth() > 0 && cachedView.getHeight() > 0) {
            boolean liveMode = tracksChanges;
            if (liveMode) {
              applyLiveIconView(view, state, id, cachedView);
            } else {
              applyStaticBitmap(state, id, cachedView,
                  cachedView.getWidth(), cachedView.getHeight());
            }
          }
        }
      }
    });
  }

  /**
   * Bind a React-rendered native view as the visual for an advanced
   * marker. Routes through one of two paths based on the marker's
   * {@code tracksViewChanges} setting:
   *
   * <ul>
   *   <li>{@code tracksViewChanges=true} (default): live iconView via
   *       SDK-owned wrapper FrameLayout — animations play in real time.</li>
   *   <li>{@code tracksViewChanges=false}: static bitmap snapshot —
   *       fastest possible composition.</li>
   * </ul>
   */
  static void setIconView(
      @NonNull RNCustomMapView view, @NonNull String markerId, @NonNull View reactView) {
    view.whenReady(() -> {
      State state = view.advancedState;
      if (state.collection == null) return;

      int width = reactView.getWidth();
      int height = reactView.getHeight();
      if (width <= 0 || height <= 0) {
        // View hasn't been measured yet; React will call us again
        // after onLayout settles.
        return;
      }

      state.iconViews.put(markerId, reactView);

      Boolean tracks = state.tracksChanges.get(markerId);
      boolean liveMode = tracks == null || tracks;

      if (liveMode) {
        applyLiveIconView(view, state, markerId, reactView);
      } else {
        applyStaticBitmap(state, markerId, reactView, width, height);
      }
    });
  }

  /**
   * Live-mode binding. Reparents the React View into our wrapper and
   * (on first call) recreates the AdvancedMarker with the wrapper as
   * iconView. Subsequent calls for the same marker just swap the
   * wrapper's child — no marker recreation, no flicker.
   */
  private static void applyLiveIconView(
      @NonNull RNCustomMapView view,
      @NonNull State state,
      @NonNull String markerId,
      @NonNull View reactView) {
    FrameLayout wrapper = state.iconWrappers.get(markerId);
    if (wrapper == null) {
      wrapper = new FrameLayout(view.getContext());
      wrapper.setLayoutParams(new ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.WRAP_CONTENT,
          ViewGroup.LayoutParams.WRAP_CONTENT));
      state.iconWrappers.put(markerId, wrapper);
    }

    // Reparent the React View into our wrapper, if not already there.
    if (reactView.getParent() != wrapper) {
      ViewGroup oldParent = (ViewGroup) reactView.getParent();
      if (oldParent != null) {
        try {
          oldParent.removeView(reactView);
        } catch (RuntimeException e) {
          android.util.Log.w("RNAdvancedMarkers",
              "removeView from old parent failed for " + markerId, e);
        }
      }
      // Clear any previous child (handles content swap on same id).
      if (wrapper.getChildCount() > 0) {
        wrapper.removeAllViews();
      }
      try {
        wrapper.addView(reactView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT));
      } catch (IllegalStateException e) {
        // Race: another parent grabbed the view between removeView and
        // addView. Drop and let the next call retry.
        android.util.Log.w("RNAdvancedMarkers",
            "addView to wrapper failed for " + markerId, e);
        return;
      }
    }

    if (state.liveMarkers.contains(markerId)) {
      // Marker already wired with this wrapper — animations are
      // already running, nothing else to do. Wrapper redraws itself
      // when its child invalidates (Animated.View / Lottie / etc).
      return;
    }

    Marker existing = state.markers.get(markerId);
    if (existing == null) return;

    // Preserve current marker fields.
    LatLng pos = existing.getPosition();
    String title = existing.getTitle();
    String snippet = existing.getSnippet();
    boolean draggable = existing.isDraggable();
    boolean flat = existing.isFlat();
    float rotation = existing.getRotation();
    float alpha = existing.getAlpha();
    float zIndex = existing.getZIndex();

    if (state.collection != null) state.collection.remove(existing);
    state.markers.remove(markerId);

    AdvancedMarkerOptions options = new AdvancedMarkerOptions()
        .position(pos)
        .title(title)
        .snippet(snippet)
        .draggable(draggable)
        .flat(flat)
        .rotation(rotation)
        .alpha(alpha)
        .anchor(0.5f, 1f)
        .zIndex((int) zIndex)
        .iconView(wrapper);

    Marker created;
    try {
      created = state.collection.addMarker(options);
    } catch (RuntimeException e) {
      android.util.Log.e("RNAdvancedMarkers",
          "addMarker with iconView failed for " + markerId, e);
      // Fall back to static bitmap so the user at least sees something.
      applyStaticBitmap(state, markerId, reactView,
          reactView.getWidth(), reactView.getHeight());
      return;
    }
    if (created != null) {
      created.setTag(markerId);
      state.markers.put(markerId, created);
      state.liveMarkers.add(markerId);
      state.staticMarkers.remove(markerId);
    }
  }

  /**
   * Static-bitmap binding. Rasterizes the React View via View.draw and
   * uses the bitmap as the marker's icon. Cached by content signature
   * so cluster recomputes are no-ops.
   */
  private static void applyStaticBitmap(
      @NonNull State state,
      @NonNull String markerId,
      @NonNull View reactView,
      int width,
      int height) {
    String signature = signatureFor(markerId, reactView, width, height);
    if (signature.equals(state.lastSignatures.get(markerId))
        && state.staticMarkers.contains(markerId)) {
      return; // unchanged
    }

    BitmapDescriptor descriptor;
    try {
      Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
      Canvas canvas = new Canvas(bitmap);
      reactView.draw(canvas);
      descriptor = BitmapDescriptorFactory.fromBitmap(bitmap);
    } catch (RuntimeException e) {
      android.util.Log.e("RNAdvancedMarkers",
          "rasterize failed for " + markerId, e);
      return;
    }

    Marker existing = state.markers.get(markerId);
    if (existing == null) return;

    // If the marker was previously in live mode, we need to recreate
    // it without iconView (the AdvancedMarker SDK doesn't let you
    // un-set an iconView in place — bitmap and iconView are mutually
    // exclusive at construction).
    if (state.liveMarkers.contains(markerId)) {
      LatLng pos = existing.getPosition();
      String title = existing.getTitle();
      String snippet = existing.getSnippet();
      if (state.collection != null) state.collection.remove(existing);
      state.markers.remove(markerId);
      detachWrapperChild(state, markerId);

      AdvancedMarkerOptions options = new AdvancedMarkerOptions()
          .position(pos)
          .title(title)
          .snippet(snippet)
          .anchor(0.5f, 1f)
          .icon(descriptor);
      Marker created = state.collection.addMarker(options);
      if (created != null) {
        created.setTag(markerId);
        state.markers.put(markerId, created);
      }
      state.liveMarkers.remove(markerId);
    } else {
      existing.setIcon(descriptor);
      existing.setAnchor(0.5f, 1f);
    }

    state.staticMarkers.add(markerId);
    state.lastIcons.put(markerId, descriptor);
    state.lastSignatures.put(markerId, signature);
  }

  /**
   * Release the live iconView for a marker. Called from JS when React
   * unmounts the snapshot view (ref callback receives null) so we can
   * detach the React View BEFORE it's deallocated by RN — prevents the
   * unmounting crash and lets GMS clean up its overlay reference.
   */
  static void releaseIconView(@NonNull RNCustomMapView view, @NonNull String markerId) {
    view.whenReady(() -> {
      State state = view.advancedState;
      state.iconViews.remove(markerId);
      detachWrapperChild(state, markerId);
      // Replace the marker's iconView with a transparent placeholder so
      // GMS doesn't hold a reference to the (now-empty) wrapper. The
      // marker itself stays — JS may push a new snapshot view shortly.
      Marker marker = state.markers.get(markerId);
      if (marker != null && state.liveMarkers.contains(markerId)) {
        // We can't swap iconView in place; recreate with bitmap.
        LatLng pos = marker.getPosition();
        String title = marker.getTitle();
        String snippet = marker.getSnippet();
        if (state.collection != null) state.collection.remove(marker);
        state.markers.remove(markerId);
        state.liveMarkers.remove(markerId);

        AdvancedMarkerOptions options = new AdvancedMarkerOptions()
            .position(pos)
            .title(title)
            .snippet(snippet)
            .anchor(0.5f, 1f)
            .icon(transparentPlaceholder());
        Marker recreated = state.collection.addMarker(options);
        if (recreated != null) {
          recreated.setTag(markerId);
          state.markers.put(markerId, recreated);
        }
      }
    });
  }

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  private static void removeMarker(@NonNull State state, @NonNull String markerId) {
    Marker m = state.markers.remove(markerId);
    if (m != null && state.collection != null) state.collection.remove(m);
    detachWrapperChild(state, markerId);
    state.iconWrappers.remove(markerId);
    state.iconViews.remove(markerId);
    state.liveMarkers.remove(markerId);
    state.staticMarkers.remove(markerId);
    state.lastIcons.remove(markerId);
    state.lastSignatures.remove(markerId);
    state.tracksChanges.remove(markerId);
  }

  private static void detachWrapperChild(@NonNull State state, @NonNull String markerId) {
    FrameLayout wrapper = state.iconWrappers.get(markerId);
    if (wrapper != null && wrapper.getChildCount() > 0) {
      try {
        wrapper.removeAllViews();
      } catch (RuntimeException e) {
        android.util.Log.w("RNAdvancedMarkers",
            "wrapper.removeAllViews failed for " + markerId, e);
      }
    }
  }

  @NonNull
  private static String signatureFor(
      @NonNull String markerId, @NonNull View view, int width, int height) {
    return markerId + ":" + System.identityHashCode(view) + ":" + width + "x" + height;
  }

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
      options.icon(initialIcon);
    } else if (!hasCustomView) {
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
