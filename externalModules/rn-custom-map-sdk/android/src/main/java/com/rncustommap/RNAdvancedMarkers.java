package com.rncustommap;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.view.Choreographer;
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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Native pipeline that backs the JS-side {@code <AdvancedMarker>} component.
 *
 * <h2>Why bitmap-pumping (and not live iconView reparenting)</h2>
 *
 * <p>Google Maps' {@code AdvancedMarkerOptions.iconView(view)} only works
 * when the supplied View has no parent. The React-rendered snapshot view
 * is parented inside React Native's snapshot subtree, so naively passing
 * it to GMS triggers {@code IllegalStateException}. The "obvious" fix —
 * call {@code parent.removeView(view); wrapper.addView(view)} to reparent
 * the view into an SDK-owned wrapper — also crashes, but later and more
 * loudly: React Native's Fabric mount layer tracks every view's parent
 * and aborts the app the next time it tries to mutate the snapshot root
 * with a stale child list:
 *
 * <pre>
 * // iOS
 * "Attempt to unmount a view which is mounted inside different view."
 *
 * // Android
 * "addViewAt: failed to insert view [N] into parent [M] at index K"
 * </pre>
 *
 * <p>The only RN-safe option is to leave the React View exactly where
 * React put it and snapshot its visual content into a bitmap that GMS
 * displays as the marker icon. For live animation we re-snapshot on a
 * {@link Choreographer} tick (30 FPS by default — high enough to feel
 * smooth, low enough to keep texture upload bandwidth in check).
 *
 * <h2>Two modes</h2>
 *
 * <ol>
 *   <li><b>Live</b> ({@code tracksViewChanges=true}, default). A single
 *       per-view Choreographer pump iterates {@link State#liveMarkers}
 *       each frame, calls {@link View#draw(Canvas)} on the snapshot
 *       view, and pushes the bitmap to the marker. Animated.View, Lottie,
 *       ActivityIndicator, Reanimated transforms — anything that
 *       repaints itself — animates on the marker because the
 *       re-rasterization captures whatever state the View is in at
 *       that frame.</li>
 *   <li><b>Static</b> ({@code tracksViewChanges=false}). One snapshot
 *       at first layout, cached by content signature, no pump. Highest
 *       FPS path; recommended for dense maps (500+ markers).</li>
 * </ol>
 */
public final class RNAdvancedMarkers {

  /**
   * Pump interval in nanoseconds. 16.67ms = 60 FPS — matches the
   * device's vsync so every animation frame on the React view is
   * captured at the rate the display can show it. 30 FPS (the previous
   * setting) caused visible judder because the animation's 60 FPS state
   * changes were sampled at half the display rate, producing every-other-
   * frame stutter regardless of how smooth the underlying animation was.
   *
   * <p>Cost: one {@code marker.setIcon} call per visible live marker
   * per frame. At typical animated-marker counts (5–10) this is well
   * under one frame budget on a mid-range device. For 50+ animated
   * markers, switch some to {@code tracksViewChanges=false} (the
   * cached-bitmap path has zero pump cost).
   */
  private static final long PUMP_INTERVAL_NS = 16_000_000L;

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
   * renderer keeps the {@link ClusterManager} API surface available.
   */
  static final class AdvancedRenderer
      extends DefaultClusterRenderer<RNAdvancedClusterItem> {
    AdvancedRenderer(Context context, GoogleMap map, ClusterManager<RNAdvancedClusterItem> cm) {
      super(context, map, cm);
      setMinClusterSize(Integer.MAX_VALUE);
    }
  }

  /** Per-view state. */
  static final class State {
    @Nullable ClusterManager<RNAdvancedClusterItem> clusterManager;
    @Nullable AdvancedRenderer renderer;
    @Nullable MarkerManager.Collection collection;
    final Map<String, Marker> markers = new HashMap<>();
    final Map<String, View> iconViews = new HashMap<>();
    /** Markers participating in the live pump (have {@code tracksViewChanges=true}). */
    final Set<String> liveMarkers = new HashSet<>();
    final Map<String, Boolean> tracksChanges = new HashMap<>();
    final Map<String, String> lastSignatures = new HashMap<>();
    /** Per-marker reusable bitmap for the live pump. */
    final Map<String, Bitmap> pumpBitmaps = new HashMap<>();
    /** Single per-view Choreographer callback that pumps all live markers. */
    @Nullable Choreographer.FrameCallback pumpCallback;
    boolean pumpRunning;
    long lastPumpTimeNs;
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
   * reused, removed when ids disappear, created otherwise. Never touches
   * marker visual content — {@link #setIconView} owns that.
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

      List<String> remove = new ArrayList<>();
      for (String existingId : state.markers.keySet()) {
        if (!incoming.containsKey(existingId)) remove.add(existingId);
      }
      for (String id : remove) {
        removeMarker(state, id);
      }

      for (String id : order) {
        ReadableMap item = incoming.get(id);
        LatLng pos = new LatLng(item.getDouble("latitude"), item.getDouble("longitude"));
        boolean hasCustomView = getBoolean(item, "hasCustomView", false);
        boolean tracksChanges = getBoolean(item, "tracksViewChanges", true);
        state.tracksChanges.put(id, tracksChanges);

        Marker existing = state.markers.get(id);

        if (existing != null) {
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
          // Live-pump membership may have toggled.
          if (tracksChanges) state.liveMarkers.add(id);
          else state.liveMarkers.remove(id);
          updatePumpRunning(view, state);
          continue;
        }

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

          // If the snapshot view already arrived (queue ordering), apply
          // it now so the placeholder doesn't flash.
          View cachedView = state.iconViews.get(id);
          if (hasCustomView && cachedView != null
              && cachedView.getWidth() > 0 && cachedView.getHeight() > 0) {
            applyIconView(view, state, id, cachedView, tracksChanges);
          }
        }
      }

      updatePumpRunning(view, state);
    });
  }

  /**
   * Bind a React-rendered native view as the visual for an advanced marker.
   * Always uses the bitmap path — the View is never reparented out of
   * React's view tree (doing so crashes RN's Fabric mount layer).
   */
  static void setIconView(
      @NonNull RNCustomMapView view, @NonNull String markerId, @NonNull View reactView) {
    view.whenReady(() -> {
      State state = view.advancedState;
      if (state.collection == null) return;

      int width = reactView.getWidth();
      int height = reactView.getHeight();
      if (width <= 0 || height <= 0) return;

      state.iconViews.put(markerId, reactView);

      Boolean tracks = state.tracksChanges.get(markerId);
      boolean tracksChanges = tracks == null || tracks;
      applyIconView(view, state, markerId, reactView, tracksChanges);
    });
  }

  /**
   * Common entry point for both modes. {@code tracksViewChanges=true}
   * registers the marker into the live pump (and does an immediate
   * one-shot rasterization so the user sees content before the next
   * pump tick); {@code false} rasterizes once with a content-signature
   * cache and stays put.
   */
  private static void applyIconView(
      @NonNull RNCustomMapView view,
      @NonNull State state,
      @NonNull String markerId,
      @NonNull View reactView,
      boolean tracksChanges) {
    Marker marker = state.markers.get(markerId);
    if (marker == null) return;
    int width = reactView.getWidth();
    int height = reactView.getHeight();
    if (width <= 0 || height <= 0) return;

    // Always do an immediate rasterization (so the placeholder
    // disappears within the same frame the snapshot view mounts).
    rasterizeOnce(state, markerId, reactView, marker, width, height,
        /*useSignatureCache=*/ !tracksChanges);

    if (tracksChanges) {
      state.liveMarkers.add(markerId);
      updatePumpRunning(view, state);
    } else {
      state.liveMarkers.remove(markerId);
      updatePumpRunning(view, state);
    }
  }

  /**
   * One-shot rasterization. Uses a reusable {@link Bitmap} keyed by
   * markerId so the live pump path avoids per-frame allocations.
   *
   * @param useSignatureCache when true, skip the rasterization if the
   *     (view-identity, width, height) signature matches the last one
   *     applied — used by the static path so cluster recomputes are
   *     no-ops.
   */
  private static void rasterizeOnce(
      @NonNull State state,
      @NonNull String markerId,
      @NonNull View reactView,
      @NonNull Marker marker,
      int width,
      int height,
      boolean useSignatureCache) {
    String signature = markerId + ":" + System.identityHashCode(reactView)
        + ":" + width + "x" + height;
    if (useSignatureCache && signature.equals(state.lastSignatures.get(markerId))) {
      return;
    }

    Bitmap bmp = state.pumpBitmaps.get(markerId);
    if (bmp == null || bmp.isRecycled()
        || bmp.getWidth() != width || bmp.getHeight() != height) {
      if (bmp != null && !bmp.isRecycled()) bmp.recycle();
      try {
        bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
      } catch (OutOfMemoryError e) {
        android.util.Log.e("RNAdvancedMarkers",
            "Bitmap.createBitmap OOM for " + markerId, e);
        return;
      }
      state.pumpBitmaps.put(markerId, bmp);
    } else {
      bmp.eraseColor(Color.TRANSPARENT);
    }

    try {
      reactView.draw(new Canvas(bmp));
    } catch (RuntimeException e) {
      android.util.Log.w("RNAdvancedMarkers",
          "draw failed for " + markerId, e);
      return;
    }

    try {
      marker.setIcon(BitmapDescriptorFactory.fromBitmap(bmp));
      marker.setAnchor(0.5f, 1f);
    } catch (RuntimeException e) {
      android.util.Log.w("RNAdvancedMarkers",
          "setIcon failed for " + markerId, e);
      return;
    }
    state.lastSignatures.put(markerId, signature);
  }

  /**
   * Start or stop the per-view Choreographer pump based on whether any
   * markers want live updates. A single callback iterates all live
   * markers — much cheaper than one callback per marker, and naturally
   * coalesces work into one composite per frame.
   */
  private static void updatePumpRunning(
      @NonNull RNCustomMapView view, @NonNull State state) {
    boolean shouldRun = !state.liveMarkers.isEmpty();
    if (shouldRun && !state.pumpRunning) {
      state.pumpRunning = true;
      state.lastPumpTimeNs = 0;
      startPump(view, state);
    } else if (!shouldRun && state.pumpRunning) {
      state.pumpRunning = false;
      // The callback re-posts itself only when pumpRunning is true, so
      // it naturally drains. We don't need to remove it explicitly.
    }
  }

  private static void startPump(
      @NonNull RNCustomMapView view, @NonNull State state) {
    final Choreographer choreographer;
    try {
      choreographer = Choreographer.getInstance();
    } catch (IllegalStateException e) {
      // Not on a UI thread with a Looper — shouldn't happen because
      // whenReady() runs on the UI thread.
      android.util.Log.e("RNAdvancedMarkers", "no Choreographer", e);
      state.pumpRunning = false;
      return;
    }

    Choreographer.FrameCallback callback = new Choreographer.FrameCallback() {
      @Override
      public void doFrame(long frameTimeNanos) {
        if (!state.pumpRunning) return;
        choreographer.postFrameCallback(this);

        if (state.lastPumpTimeNs != 0
            && frameTimeNanos - state.lastPumpTimeNs < PUMP_INTERVAL_NS) {
          return; // throttle to ~30 FPS
        }
        state.lastPumpTimeNs = frameTimeNanos;

        // Snapshot of live markers (copy because the live pump may
        // remove ids if a rasterization fails).
        List<String> ids = new ArrayList<>(state.liveMarkers);
        for (String id : ids) {
          View src = state.iconViews.get(id);
          Marker marker = state.markers.get(id);
          if (src == null || marker == null) continue;
          int w = src.getWidth();
          int h = src.getHeight();
          if (w <= 0 || h <= 0) continue;
          rasterizeOnce(state, id, src, marker, w, h, /*useSignatureCache=*/ false);
        }
      }
    };
    state.pumpCallback = callback;
    choreographer.postFrameCallback(callback);
  }

  /**
   * Release the live binding for a marker — called from JS when React
   * unmounts the snapshot view (ref callback returns null). Removes the
   * marker from the live pump and clears the cached snapshot reference
   * so we never try to {@link View#draw(Canvas)} on a deallocated view.
   */
  static void releaseIconView(@NonNull RNCustomMapView view, @NonNull String markerId) {
    view.whenReady(() -> {
      State state = view.advancedState;
      state.iconViews.remove(markerId);
      state.liveMarkers.remove(markerId);
      state.lastSignatures.remove(markerId);
      Bitmap bmp = state.pumpBitmaps.remove(markerId);
      if (bmp != null && !bmp.isRecycled()) bmp.recycle();
      Marker marker = state.markers.get(markerId);
      if (marker != null) {
        try {
          marker.setIcon(transparentPlaceholder());
        } catch (RuntimeException ignored) {}
      }
      updatePumpRunning(view, state);
    });
  }

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------

  private static void removeMarker(@NonNull State state, @NonNull String markerId) {
    Marker m = state.markers.remove(markerId);
    if (m != null && state.collection != null) state.collection.remove(m);
    state.iconViews.remove(markerId);
    state.liveMarkers.remove(markerId);
    state.lastSignatures.remove(markerId);
    state.tracksChanges.remove(markerId);
    Bitmap bmp = state.pumpBitmaps.remove(markerId);
    if (bmp != null && !bmp.isRecycled()) bmp.recycle();
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
