package com.rncustommap;

import android.util.Log;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.UIManager;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.uimanager.UIManagerHelper;

/**
 * NativeModule entry point for rn-custom-map-sdk imperative commands.
 *
 * <p>View resolution uses a two-tier lookup:
 *
 * <ol>
 *   <li><b>Static view registry</b> on {@link RNCustomMapView#findViewByTag(int)}
 *       — populated synchronously in setId(). This is the path that fixes the
 *       edge-indicator "ref doesn't reach the view" bug.</li>
 *   <li><b>UIManager fallback</b> — used only if (1) misses, which can happen
 *       for views whose id has been re-assigned during a reparent.</li>
 * </ol>
 */
@ReactModule(name = RNCustomMapModule.NAME)
public class RNCustomMapModule extends NativeRNCustomMapViewManagerSpec {
  public static final String NAME = NativeRNCustomMapViewManagerSpec.NAME;
  private static final String TAG = "RNCustomMapModule";

  public RNCustomMapModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  /**
   * Resolves a mounted {@link RNCustomMapView} for a given React tag.
   *
   * <p>Order:
   * <ol>
   *   <li>Static {@code viewRegistry} — fast, lock-free, immune to UIManager
   *       commit races.</li>
   *   <li>{@link UIManagerHelper#getUIManagerForReactTag} — fallback that
   *       handles reparented / re-tagged views.</li>
   * </ol>
   */
  @Nullable
  private RNCustomMapView resolveMap(int reactTag) {
    // Tier 1: direct registry lookup. Works regardless of caller thread or
    // UIManager commit phase. This is the path edge-indicator callbacks
    // take and is why animateToRegion now works from them.
    RNCustomMapView registered = RNCustomMapView.findViewByTag(reactTag);
    if (registered != null) {
      return registered;
    }

    // Tier 2: UIManager fallback for edge cases (reparented views).
    UIManager uiManager =
        UIManagerHelper.getUIManagerForReactTag(getReactApplicationContext(), reactTag);
    if (uiManager == null) {
      Log.e(TAG, "resolveMap: no view found for tag=" + reactTag);
      return null;
    }
    View view = uiManager.resolveView(reactTag);
    if (view instanceof RNCustomMapView) {
      return (RNCustomMapView) view;
    }
    Log.e(TAG, "resolveMap: tag=" + reactTag + " resolved to " +
        (view == null ? "null" : view.getClass().getName()));
    return null;
  }

  /** Marshals onto the UI thread and runs the action with a resolved map view. */
  private void withMap(int reactTag, String method, MapAction action) {
    UiThreadUtil.runOnUiThread(() -> {
      RNCustomMapView view = resolveMap(reactTag);
      if (view == null) {
        Log.w(TAG, method + ": no view for tag=" + reactTag +
            " (registry size=" + RNCustomMapView.registrySize() + ")");
        return;
      }
      try {
        action.run(view);
      } catch (RuntimeException e) {
        Log.e(TAG, method + " threw", e);
      }
    });
  }

  private interface MapAction {
    void run(RNCustomMapView view);
  }

  // -------------------- Map methods --------------------

  @Override
  public void animateToRegion(double reactTag, ReadableMap region, double duration) {
    withMap((int) reactTag, "animateToRegion", view ->
        RNCustomMapViewManagerImpl.setRegion(view, region, false));
  }

  @Override
  public void animateToCoordinate(double reactTag, ReadableMap coordinate, double duration) {
    withMap((int) reactTag, "animateToCoordinate", view -> {
      WritableNativeMap center = new WritableNativeMap();
      center.putDouble("latitude", coordinate.getDouble("latitude"));
      center.putDouble("longitude", coordinate.getDouble("longitude"));
      WritableNativeMap camera = new WritableNativeMap();
      camera.putMap("center", center);
      camera.putDouble("zoom",
          view.googleMap == null ? 12d : view.googleMap.getCameraPosition().zoom);
      RNCustomMapViewManagerImpl.setCamera(view, camera, (int) duration);
    });
  }

  @Override
  public void fitToCoordinates(double reactTag, ReadableArray coordinates,
                               @Nullable ReadableMap options) {
    withMap((int) reactTag, "fitToCoordinates", view ->
        RNCustomMapViewManagerImpl.fitToCoordinates(view, coordinates, options));
  }

  @Override
  public void fitToElements(double reactTag, @Nullable ReadableMap options) {
    withMap((int) reactTag, "fitToElements", view ->
        RNCustomMapViewManagerImpl.fitToElements(view, options));
  }

  @Override
  public void fitToSuppliedMarkers(double reactTag, ReadableArray markerIds,
                                   @Nullable ReadableMap options) {
    withMap((int) reactTag, "fitToSuppliedMarkers", view ->
        RNCustomMapViewManagerImpl.fitToSuppliedMarkers(view, markerIds, options));
  }

  @Override
  public void getCamera(double reactTag, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      RNCustomMapView view = resolveMap((int) reactTag);
      if (view == null) {
        promise.reject("E_NO_VIEW", "RNCustomMapView not found for tag " + (int) reactTag);
        return;
      }
      promise.resolve(RNCustomMapViewManagerImpl.camera(view));
    });
  }

  @Override
  public void setCamera(double reactTag, ReadableMap camera, double duration) {
    withMap((int) reactTag, "setCamera", view ->
        RNCustomMapViewManagerImpl.setCamera(view, camera, (int) duration));
  }

  @Override
  public void getMarkers(double reactTag, Promise promise) {
    UiThreadUtil.runOnUiThread(() -> {
      RNCustomMapView view = resolveMap((int) reactTag);
      if (view == null) {
        promise.reject("E_NO_VIEW", "RNCustomMapView not found for tag " + (int) reactTag);
        return;
      }
      promise.resolve(RNCustomMapViewManagerImpl.markers(view));
    });
  }

  // -------------------- Lifecycle methods (Issue 2 fix) --------------------

  /**
   * Called from the JS hook {@code useMapTabLifecycle} when a tab gains or
   * loses focus. {@code active=true} resumes the embedded MapView (creating
   * the GL surface if needed); {@code active=false} pauses it.
   */
  @Override
  public void setActive(double reactTag, boolean active) {
    withMap((int) reactTag, "setActive", view -> {
      if (active) {
        view.onHostResume();
      } else {
        view.onHostPause();
      }
    });
  }

  /**
   * Forces the embedded MapView to re-layout and refresh its GL surface.
   * Used by the JS hook on tab focus to defeat the API 30/33 white-screen
   * bug that occurs after a detach/reattach cycle.
   */
  @Override
  public void forceRedraw(double reactTag) {
    withMap((int) reactTag, "forceRedraw", RNCustomMapView::forceRedraw);
  }

  // -------------------- Marker methods --------------------

  @Override
  public void showMarkerCallout(double reactTag, String markerId) {
    withMap((int) reactTag, "showMarkerCallout", view -> {
      if (markerId == null || markerId.isEmpty()) {
        Log.e(TAG, "showMarkerCallout: markerId is null/empty");
        return;
      }
      RNCustomMapViewManagerImpl.showMarkerCallout(view, markerId);
    });
  }

  @Override
  public void hideMarkerCallout(double reactTag, String markerId) {
    withMap((int) reactTag, "hideMarkerCallout", view -> {
      if (markerId == null || markerId.isEmpty()) return;
      RNCustomMapViewManagerImpl.hideMarkerCallout(view, markerId);
    });
  }

  @Override
  public void redrawMarker(double reactTag, String markerId) {
    withMap((int) reactTag, "redrawMarker", view -> {
      if (markerId == null || markerId.isEmpty()) return;
      RNCustomMapViewManagerImpl.redrawMarker(view, markerId);
    });
  }

  @Override
  public void animateMarkerToCoordinate(
      double reactTag,
      String markerId,
      ReadableMap coordinate,
      @Nullable ReadableMap options) {
    withMap((int) reactTag, "animateMarkerToCoordinate", view -> {
      if (markerId == null || markerId.isEmpty() || coordinate == null) return;
      RNCustomMapViewManagerImpl.animateMarkerToCoordinate(view, markerId, coordinate, options);
    });
  }

  @Override
  public void setMarkerView(double reactTag, String markerId, double markerViewTag) {
    UiThreadUtil.runOnUiThread(() -> {
      RNCustomMapView mapView = resolveMap((int) reactTag);
      if (mapView == null) return;

      UIManager uiManager =
          UIManagerHelper.getUIManagerForReactTag(getReactApplicationContext(), (int) markerViewTag);
      if (uiManager == null) return;

      View markerView = uiManager.resolveView((int) markerViewTag);
      if (markerView != null) {
        RNCustomMapViewManagerImpl.setMarkerView(mapView, markerId, markerView);
      }
    });
  }
}
