package com.rncustommap;

import android.Manifest;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.bumptech.glide.request.target.CustomTarget;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.RCTEventEmitter;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.MapView;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.model.CameraPosition;
import com.google.android.gms.maps.model.Circle;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.Polyline;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Native host view for rn-custom-map-sdk.
 *
 * Two key fixes baked in:
 *
 *  1. {@link #viewRegistry} — a process-wide map from React tag → view instance,
 *     populated synchronously in {@link #setId(int)}. The NativeModule looks up
 *     views via {@link #findViewByTag(int)} so commands originating from edge
 *     indicators (which can fire before the UIManager has fully committed the
 *     shadow tree) always find the right view. This is what makes
 *     {@code mapRef.current.animateToRegion(...)} reliable regardless of caller.
 *
 *  2. Explicit Android lifecycle bridging for use inside @react-navigation
 *     bottom tabs. The Google MapView holds a GL surface that is torn down when
 *     the view is detached from the window (which is what bottom-tabs does
 *     when switching tabs on API 30 / 33). We forward lifecycle events from
 *     onAttachedToWindow / onDetachedFromWindow, and additionally expose
 *     {@link #onHostResume()} / {@link #onHostPause()} / {@link #forceRedraw()}
 *     for the JS-side {@code useMapTabLifecycle} hook so focus changes can
 *     drive a clean resume + surface refresh, preventing the white-screen bug.
 */
public class RNCustomMapView extends FrameLayout implements OnMapReadyCallback {

  // ------------------------------------------------------------------------
  // View registry — Issue 1 fix
  // ------------------------------------------------------------------------

  /**
   * Strong-ref registry keyed by React tag. Populated in {@link #setId(int)}
   * (called by React's UI thread immediately after createViewInstance), and
   * cleared in {@link RNCustomMapViewManager#onDropViewInstance} or when the
   * view is finally destroyed. Kept synchronized for cross-thread safety.
   */
  private static final Map<Integer, RNCustomMapView> viewRegistry =
      Collections.synchronizedMap(new HashMap<>());

  /**
   * Look up a mounted RNCustomMapView by its React tag. Returns null if the
   * view has been dropped or never had its id assigned.
   *
   * <p>Prefer this over {@code UIManagerHelper.resolveView()} for commands
   * dispatched from edge indicators, gesture handlers, or any callsite that
   * may race with UIManager commits.
   */
  @Nullable
  public static RNCustomMapView findViewByTag(int reactTag) {
    return viewRegistry.get(reactTag);
  }

  static int registrySize() {
    return viewRegistry.size();
  }

  // ------------------------------------------------------------------------
  // Map fields (kept package-private to match existing ManagerImpl access)
  // ------------------------------------------------------------------------

  final MapView mapView;
  @Nullable GoogleMap googleMap;
  final Map<String, Marker> markers = new HashMap<>();
  final Map<String, Polyline> polylines = new HashMap<>();
  final Map<String, Circle> circles = new HashMap<>();
  final Map<String, WritableMap> markerPayloads = new HashMap<>();
  final Map<String, Boolean> markerTappables = new HashMap<>();
  final Map<String, CustomTarget<android.graphics.Bitmap>> markerIconTargets = new HashMap<>();
  /**
   * Last icon cache key applied to each marker. The {@link RNCustomMapViewManagerImpl}
   * uses this to decide whether {@code marker.setIcon(...)} actually needs to
   * be called on a diff pass — which is what prevents the "default pin flash"
   * reported in Issue 2. Keys are produced by
   * {@code RNCustomMapViewManagerImpl#iconCacheKeyForItem}.
   */
  final Map<String, String> markerIconKeys = new HashMap<>();

  private final List<Runnable> pending = new ArrayList<>();
  @Nullable String selectedMarkerId;

  private boolean lastRegionChangeWasGesture = false;
  private boolean initialRegionApplied = false;
  private float minZoom = 0f;
  private float maxZoom = 21f;

  // Lifecycle bookkeeping — Issue 2 fix
  private boolean lifecycleCreated = false;
  private boolean lifecycleStarted = false;
  private boolean lifecycleResumed = false;
  private boolean lifecycleDestroyed = false;

  /** True when JS has called setActive(false) (e.g. tab is blurred). */
  private boolean tabActive = true;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());

  // ------------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------------

  public RNCustomMapView(ReactContext context) {
    super(context);
    mapView = new MapView(context);
    // Create only; do NOT call onStart/onResume here. The actual start/resume
    // is driven by onAttachedToWindow + the JS lifecycle hook, which makes
    // the map robust across bottom-tab focus changes on API 30/33.
    mapView.onCreate(new Bundle());
    lifecycleCreated = true;
    addView(mapView, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    mapView.getMapAsync(this);
  }

  // ------------------------------------------------------------------------
  // ID assignment — register synchronously so module lookups never race
  // ------------------------------------------------------------------------

  @Override
  public void setId(int id) {
    // RN may set id more than once during reparenting — keep the registry
    // consistent by removing the old mapping first.
    int previous = getId();
    super.setId(id);
    if (previous != NO_ID && previous != id) {
      viewRegistry.remove(previous);
    }
    if (id != NO_ID) {
      viewRegistry.put(id, this);
    }
  }

  // ------------------------------------------------------------------------
  // Window attach / detach — drive lifecycle automatically
  // ------------------------------------------------------------------------

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    onHostResume();
  }

  @Override
  protected void onDetachedFromWindow() {
    // Pause but do NOT destroy — the view may re-attach when the tab is
    // selected again. Destruction happens in onDropViewInstance.
    onHostPause();
    super.onDetachedFromWindow();
  }

  // ------------------------------------------------------------------------
  // Public lifecycle API for the JS-side hook + bottom-tab focus changes
  // ------------------------------------------------------------------------

  /**
   * Bring the embedded Google MapView to RESUMED state. Idempotent and safe
   * to call from any focus-effect / attach callback.
   */
  public void onHostResume() {
    if (lifecycleDestroyed) {
      return;
    }
    if (!lifecycleCreated) {
      mapView.onCreate(new Bundle());
      lifecycleCreated = true;
    }
    if (!lifecycleStarted) {
      mapView.onStart();
      lifecycleStarted = true;
    }
    if (!lifecycleResumed) {
      mapView.onResume();
      lifecycleResumed = true;
    }
    tabActive = true;
    // API 30/33 in particular needs an explicit surface refresh after a
    // detach/reattach cycle, otherwise the SurfaceView paints white. We
    // schedule it on the next frame so the GL surface has time to recreate.
    mainHandler.post(this::forceRedraw);
  }

  /**
   * Move the embedded Google MapView to PAUSED state. Called automatically
   * when the view detaches from window, or explicitly from the focus-effect
   * hook when the tab loses focus.
   */
  public void onHostPause() {
    if (lifecycleDestroyed) {
      return;
    }
    if (lifecycleResumed) {
      mapView.onPause();
      lifecycleResumed = false;
    }
    if (lifecycleStarted) {
      mapView.onStop();
      lifecycleStarted = false;
    }
    tabActive = false;
  }

  /**
   * Called once from the ViewManager when the view is being permanently
   * destroyed. Releases all native resources and removes the view from the
   * registry.
   */
  public void destroy() {
    if (lifecycleDestroyed) {
      return;
    }
    onHostPause();
    mapView.onDestroy();
    lifecycleDestroyed = true;
    int id = getId();
    if (id != NO_ID) {
      viewRegistry.remove(id);
    }
  }

  /**
   * Force the embedded MapView to re-layout and invalidate its GL surface.
   * This is the workaround for the API 30/33 white-screen bug that occurs
   * when a Google MapView is re-attached inside a bottom-tab navigator.
   *
   * <p>Implementation notes:
   *   - {@code requestLayout()} forces a new measure/layout pass
   *   - {@code invalidate()} schedules a redraw of the SurfaceView host
   *   - re-applying the current map type causes Google's renderer to
   *     re-acquire the GL context, which is what actually clears white tiles
   *     on older API levels. On API 34+ this is a no-op cost.
   */
  public void forceRedraw() {
    if (lifecycleDestroyed) {
      return;
    }
    requestLayout();
    invalidate();
    mapView.requestLayout();
    mapView.invalidate();

    if (googleMap != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE /* < 34 */) {
      final int currentType = googleMap.getMapType();
      // Bounce the map type to force a renderer refresh. The toggle happens
      // in the same frame, so it is invisible to the user but forces the
      // SurfaceTexture to be re-acquired.
      googleMap.setMapType(currentType == GoogleMap.MAP_TYPE_NORMAL
          ? GoogleMap.MAP_TYPE_NONE
          : GoogleMap.MAP_TYPE_NORMAL);
      mainHandler.post(() -> {
        if (googleMap != null) {
          googleMap.setMapType(currentType);
        }
      });
    }
  }

  // ------------------------------------------------------------------------
  // GoogleMap ready
  // ------------------------------------------------------------------------

  @Override
  public void onMapReady(@NonNull GoogleMap map) {
    googleMap = map;
    map.setOnMapClickListener(latLng -> emitCoordinate("onPress", latLng));
    map.setOnMapLongClickListener(latLng -> emitCoordinate("onLongPress", latLng));
    map.setOnMarkerClickListener(marker -> {
      Object tag = marker.getTag();
      String id = tag instanceof String ? (String) tag : "";
      if (markerTappables.containsKey(id) && !Boolean.TRUE.equals(markerTappables.get(id))) {
        return true;
      }
      if (selectedMarkerId != null && !selectedMarkerId.equals(id)) {
        Marker selectedMarker = markers.get(selectedMarkerId);
        if (selectedMarker != null) {
          emitMarker("onMarkerDeselect", selectedMarker);
        }
      }
      selectedMarkerId = id;
      emitMarker("onMarkerPress", marker);
      emitMarker("onMarkerSelect", marker);
      return false;
    });
    map.setOnInfoWindowClickListener(marker -> emitMarker("onCalloutPress", marker));
    map.setOnPolylineClickListener(polyline -> {
      WritableMap event = Arguments.createMap();
      Object tag = polyline.getTag();
      event.putString("id", tag instanceof String ? (String) tag : "");
      emit("onPolylinePress", event);
    });
    map.setOnMarkerDragListener(new GoogleMap.OnMarkerDragListener() {
      @Override public void onMarkerDragStart(@NonNull Marker marker) { emitMarker("onMarkerDragStart", marker); }
      @Override public void onMarkerDrag(@NonNull Marker marker) { emitMarker("onMarkerDrag", marker); }
      @Override public void onMarkerDragEnd(@NonNull Marker marker) { emitMarker("onMarkerDragEnd", marker); }
    });
    map.setOnCameraMoveStartedListener(reason ->
        lastRegionChangeWasGesture = reason == GoogleMap.OnCameraMoveStartedListener.REASON_GESTURE);
    map.setOnCameraMoveListener(() -> emitRegion("onRegionChange"));
    map.setOnCameraIdleListener(() -> emitRegion("onRegionChangeComplete"));
    map.setOnMyLocationChangeListener(this::emitUserLocation);
    map.setMinZoomPreference(minZoom);
    map.setMaxZoomPreference(maxZoom);

    for (Runnable runnable : pending) {
      runnable.run();
    }
    pending.clear();
    emitEmpty("onMapReady");
  }

  // ------------------------------------------------------------------------
  // Pending-queue + gesture pass-through (unchanged behavior)
  // ------------------------------------------------------------------------

  void whenReady(Runnable runnable) {
    if (googleMap == null) {
      pending.add(runnable);
    } else {
      runnable.run();
    }
  }

  void setZoomEnabled(boolean enabled) {
    whenReady(() -> googleMap.getUiSettings().setZoomGesturesEnabled(enabled));
  }

  void setScrollEnabled(boolean enabled) {
    whenReady(() -> googleMap.getUiSettings().setScrollGesturesEnabled(enabled));
  }

  void setRotateEnabled(boolean enabled) {
    whenReady(() -> googleMap.getUiSettings().setRotateGesturesEnabled(enabled));
  }

  void setPitchEnabled(boolean enabled) {
    whenReady(() -> googleMap.getUiSettings().setTiltGesturesEnabled(enabled));
  }

  void setMinZoomLevel(float value) {
    minZoom = value;
    whenReady(() -> googleMap.setMinZoomPreference(value));
  }

  void setMaxZoomLevel(float value) {
    maxZoom = value;
    whenReady(() -> googleMap.setMaxZoomPreference(value));
  }

  boolean shouldApplyInitialRegion() {
    if (initialRegionApplied) {
      return false;
    }
    initialRegionApplied = true;
    return true;
  }

  @Override
  protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
    super.onLayout(changed, left, top, right, bottom);
    mapView.layout(0, 0, right - left, bottom - top);
  }

  @Override
  public boolean dispatchTouchEvent(MotionEvent event) {
    requestDisallowInterceptTouchEvent(true);
    return super.dispatchTouchEvent(event);
  }

  // ------------------------------------------------------------------------
  // Event emission helpers (unchanged)
  // ------------------------------------------------------------------------

  private void emitCoordinate(String eventName, LatLng latLng) {
    WritableMap event = Arguments.createMap();
    event.putMap("coordinate", coordinate(latLng));
    emit(eventName, event);
  }

  void emitMarkerEvent(String eventName, Marker marker) {
    emitMarker(eventName, marker);
  }

  private void emitMarker(String eventName, Marker marker) {
    WritableMap event = Arguments.createMap();
    Object tag = marker.getTag();
    event.putString("id", tag instanceof String ? (String) tag : "");
    event.putMap("coordinate", coordinate(marker.getPosition()));
    emit(eventName, event);
  }

  private void emitRegion(String eventName) {
    if (googleMap == null) {
      return;
    }
    CameraPosition position = googleMap.getCameraPosition();
    LatLngBounds bounds = googleMap.getProjection().getVisibleRegion().latLngBounds;
    WritableMap region = Arguments.createMap();
    region.putDouble("latitude", position.target.latitude);
    region.putDouble("longitude", position.target.longitude);
    region.putDouble("latitudeDelta", Math.abs(bounds.northeast.latitude - bounds.southwest.latitude));
    double longitudeDelta = Math.abs(bounds.northeast.longitude - bounds.southwest.longitude);
    region.putDouble("longitudeDelta", longitudeDelta > 180d ? 360d - longitudeDelta : longitudeDelta);
    WritableMap details = Arguments.createMap();
    details.putBoolean("isGesture", lastRegionChangeWasGesture);
    WritableMap event = Arguments.createMap();
    event.putMap("region", region);
    event.putMap("details", details);
    emit(eventName, event);
  }

  private void emitUserLocation(Location location) {
    if (location == null) {
      return;
    }
    WritableMap event = Arguments.createMap();
    event.putMap("coordinate", coordinate(new LatLng(location.getLatitude(), location.getLongitude())));
    emit("onUserLocationChange", event);
  }

  private void emitEmpty(String eventName) {
    emit(eventName, Arguments.createMap());
  }

  private WritableMap coordinate(LatLng latLng) {
    WritableMap coordinate = Arguments.createMap();
    coordinate.putDouble("latitude", latLng.latitude);
    coordinate.putDouble("longitude", latLng.longitude);
    return coordinate;
  }

  private void emit(String eventName, WritableMap event) {
    ReactContext context = (ReactContext) getContext();
    if (context == null) {
      return;
    }
    context.getJSModule(RCTEventEmitter.class).receiveEvent(getId(), eventName, event);
  }
}
