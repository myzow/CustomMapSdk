package com.rncustommap;

import android.animation.TypeEvaluator;
import android.animation.ValueAnimator;
import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.util.LruCache;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.Interpolator;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import com.bumptech.glide.Glide;
import com.bumptech.glide.request.target.CustomTarget;
import com.bumptech.glide.request.transition.Transition;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableType;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.UIManagerHelper;
import com.facebook.react.uimanager.common.UIManagerType;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.model.BitmapDescriptor;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.CircleOptions;
import com.google.android.gms.maps.model.Dash;
import com.google.android.gms.maps.model.Gap;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.maps.model.PatternItem;
import com.google.android.gms.maps.model.Polyline;
import com.google.android.gms.maps.model.PolylineOptions;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class RNCustomMapViewManagerImpl {
  // NOTE: View lookup now lives on RNCustomMapView.viewRegistry (populated in
  // setId, see RNCustomMapView.java). These methods are kept as thin
  // back-compat shims so any callers outside the Module continue to work.
  private RNCustomMapViewManagerImpl() {}

  // ---------------------------------------------------------------------
  // Marker icon cache (Issue 2 fix).
  //
  // Keys:
  //   "src:<url-or-path>"     remote / local marker image sources
  //   "pin:<colorHex>"         pinColor default markers
  //   "view:<markerId>:<sig>"  snapshots produced by setMarkerView
  //
  // 4 MiB is plenty for the typical use case (≤ a few hundred unique marker
  // icons at standard pin sizes). Storing the resulting BitmapDescriptors
  // alongside the bitmaps would be ideal but BitmapDescriptor is not
  // bytesize-introspectable, so we re-wrap on lookup — that's a no-op cost
  // because BitmapDescriptorFactory.fromBitmap doesn't decode anything when
  // the Bitmap is already in memory.
  // ---------------------------------------------------------------------
  private static final LruCache<String, Bitmap> ICON_CACHE = new LruCache<String, Bitmap>(4 * 1024 * 1024) {
    @Override
    protected int sizeOf(String key, Bitmap value) {
      return value.getByteCount();
    }
  };

  @Nullable
  static Bitmap getCachedIcon(String key) {
    if (key == null) return null;
    return ICON_CACHE.get(key);
  }

  static void putCachedIcon(String key, Bitmap bitmap) {
    if (key != null && bitmap != null) {
      ICON_CACHE.put(key, bitmap);
    }
  }

  /**
   * Stable cache key for a marker's icon spec — same shape as the iOS side.
   * Markers with the same source share a Bitmap across the entire map, which
   * is what kills the "default pin flash" reported in Issue 2.
   */
  private static String iconCacheKeyForItem(ReadableMap item) {
    String source = getString(item, "icon");
    if (source == null) source = getString(item, "image");
    if (source != null && source.length() > 0) return "src:" + source;
    String pin = getString(item, "pinColor");
    if (pin != null && pin.length() > 0) return "pin:" + pin;
    // Cluster synthetic markers carry no icon/pinColor; they get a transparent
    // placeholder. Keep their cache slot separate from regular default-pin
    // markers so the two never share a Bitmap by accident.
    String id = getString(item, "id");
    if (id != null && id.startsWith("cluster:")) return "cluster:placeholder";
    return "pin:default";
  }

  static void register(RNCustomMapView view) {
    // no-op: RNCustomMapView.setId() handles registration synchronously.
  }

  static void unregister(RNCustomMapView view) {
    // no-op: RNCustomMapView.destroy() handles removal.
  }

  @Nullable
  static RNCustomMapView findViewByTag(int reactTag) {
    return RNCustomMapView.findViewByTag(reactTag);
  }

  static void setRegion(RNCustomMapView view, @Nullable ReadableMap region, boolean initial) {
    if (region == null || (initial && !view.shouldApplyInitialRegion())) {
      return;
    }
    LatLng center = coordinate(region);
    float zoom = zoomFromDelta(region.getDouble("longitudeDelta"));
    view.whenReady(() -> view.googleMap.moveCamera(CameraUpdateFactory.newLatLngZoom(center, zoom)));
  }

  static void setCamera(RNCustomMapView view, @Nullable ReadableMap camera, int duration) {
    if (camera == null || !camera.hasKey("center")) {
      return;
    }
    ReadableMap centerMap = camera.getMap("center");
    LatLng center = coordinate(centerMap);
    com.google.android.gms.maps.model.CameraPosition position =
        new com.google.android.gms.maps.model.CameraPosition.Builder()
            .target(center)
            .zoom((float) getDouble(camera, "zoom", 12d))
            .tilt((float) getDouble(camera, "pitch", 0d))
            .bearing((float) getDouble(camera, "heading", 0d))
            .build();
    view.whenReady(() -> {
      if (duration > 0) {
        view.googleMap.animateCamera(CameraUpdateFactory.newCameraPosition(position), duration, null);
      } else {
        view.googleMap.moveCamera(CameraUpdateFactory.newCameraPosition(position));
      }
    });
  }

  static void setProvider(RNCustomMapView view, @Nullable String provider) {
    // Google Maps is the Android default. The JS API accepts "openstreetmap"
    // for future optional provider wiring without breaking prop validation.
  }

  static void setMapType(RNCustomMapView view, @Nullable String mapType) {
    view.whenReady(() -> {
      if ("satellite".equals(mapType)) {
        view.googleMap.setMapType(GoogleMap.MAP_TYPE_SATELLITE);
      } else if ("hybrid".equals(mapType)) {
        view.googleMap.setMapType(GoogleMap.MAP_TYPE_HYBRID);
      } else if ("terrain".equals(mapType)) {
        view.googleMap.setMapType(GoogleMap.MAP_TYPE_TERRAIN);
      } else {
        view.googleMap.setMapType(GoogleMap.MAP_TYPE_NORMAL);
      }
    });
  }

  static void setCustomMapStyle(RNCustomMapView view, @Nullable String style) {
    if (style == null) {
      return;
    }
    view.whenReady(() -> view.googleMap.setMapStyle(
        new com.google.android.gms.maps.model.MapStyleOptions(style)));
  }

  static void setShowsUserLocation(RNCustomMapView view, boolean enabled) {
    view.whenReady(() -> {
      boolean granted = ContextCompat.checkSelfPermission(view.getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
          == PackageManager.PERMISSION_GRANTED;
      if (granted) {
        view.googleMap.setMyLocationEnabled(enabled);
      }
    });
  }

  static void setMarkers(RNCustomMapView view, @Nullable ReadableArray markers) {
    view.whenReady(() -> {
      // -----------------------------------------------------------------
      // Incremental diff (Issue 2 fix).
      //
      // The old implementation removed every marker and rebuilt them from
      // scratch on every prop update. With clustering on, that meant every
      // cluster recompute flashed the default Google pin before the icon
      // image finished re-applying. We now diff by id and:
      //   - keep markers whose id is unchanged
      //   - only update position / title when they actually change
      //   - only re-apply the icon when the source key changed
      //   - never re-add a marker that's already on the map
      // Single (passthrough) markers therefore never re-render on zoom,
      // and clustered markers re-render with their cached bitmap.
      // -----------------------------------------------------------------
      ReadableArray incoming = markers != null ? markers : Arguments.createArray();

      java.util.HashSet<String> incomingIds = new java.util.HashSet<>(incoming.size());
      for (int i = 0; i < incoming.size(); i++) {
        ReadableMap item = incoming.getMap(i);
        String id = item.hasKey("id") ? item.getString("id") : "marker-" + i;
        incomingIds.add(id);
      }

      // 1) Drop markers that are gone.
      java.util.ArrayList<String> existingIds = new java.util.ArrayList<>(view.markers.keySet());
      for (String existingId : existingIds) {
        if (!incomingIds.contains(existingId)) {
          Marker gone = view.markers.remove(existingId);
          if (gone != null) gone.remove();
          view.markerPayloads.remove(existingId);
          view.markerTappables.remove(existingId);
          view.markerIconKeys.remove(existingId);
          view.markerIconTargets.remove(existingId);
          if (existingId.equals(view.selectedMarkerId)) {
            view.selectedMarkerId = null;
          }
        }
      }

      // 2) Update / create.
      for (int i = 0; i < incoming.size(); i++) {
        ReadableMap item = incoming.getMap(i);
        String id = item.hasKey("id") ? item.getString("id") : "marker-" + i;
        LatLng position = new LatLng(item.getDouble("latitude"), item.getDouble("longitude"));
        String iconKey = iconCacheKeyForItem(item);
        Marker marker = view.markers.get(id);

        if (marker == null) {
          // Brand-new marker. Build with options + icon up front so it
          // appears with the right visuals on its very first frame.
          MarkerOptions options = new MarkerOptions()
              .position(position)
              .title(getString(item, "title"))
              .snippet(getString(item, "description"))
              .draggable(getBoolean(item, "draggable", false))
              .flat(getBoolean(item, "flat", false))
              .rotation((float) getDouble(item, "rotation", 0d))
              .alpha((float) getDouble(item, "opacity", 1d));
          applyAnchor(options, item);
          applyInitialMarkerIcon(options, item, /*useCachedRemote=*/true);
          marker = view.googleMap.addMarker(options);
          if (marker == null) continue;
          marker.setTag(id);
          view.markers.put(id, marker);
          view.markerIconKeys.put(id, iconKey);
          // Async-load remote icons only when not already cached.
          loadRemoteMarkerIcon(view, marker, id, item);
        } else {
          // Existing marker — surgical updates only.
          if (marker.getPosition().latitude != position.latitude
              || marker.getPosition().longitude != position.longitude) {
            marker.setPosition(position);
          }
          String newTitle = getString(item, "title");
          if (newTitle != null && !newTitle.equals(marker.getTitle())) marker.setTitle(newTitle);
          String newSnippet = getString(item, "description");
          if (newSnippet != null && !newSnippet.equals(marker.getSnippet())) marker.setSnippet(newSnippet);
          marker.setDraggable(getBoolean(item, "draggable", false));
          marker.setFlat(getBoolean(item, "flat", false));
          marker.setRotation((float) getDouble(item, "rotation", 0d));
          marker.setAlpha((float) getDouble(item, "opacity", 1d));

          // Only re-apply the icon if the source key actually changed. This
          // is the single most important line for Issue 2 — keeps the icon
          // stable across re-clustering.
          String previousKey = view.markerIconKeys.get(id);
          if (previousKey == null || !previousKey.equals(iconKey)) {
            applyIconFromCacheOrSource(marker, item, iconKey);
            view.markerIconKeys.put(id, iconKey);
            loadRemoteMarkerIcon(view, marker, id, item);
          }
        }

        view.markerPayloads.put(id, markerPayload(id, item));
        view.markerTappables.put(id, getBoolean(item, "tappable", true));
      }
    });
  }

  /**
   * Used by the incremental diff to re-apply a marker icon when its source
   * key changed but the marker itself is being preserved. Hits the
   * process-wide bitmap cache so a cluster bubble returning at the same zoom
   * level shows instantly.
   */
  private static void applyIconFromCacheOrSource(Marker marker, ReadableMap item, String iconKey) {
    Bitmap cached = getCachedIcon(iconKey);
    if (cached != null && !cached.isRecycled()) {
      marker.setIcon(BitmapDescriptorFactory.fromBitmap(cached));
      return;
    }
    BitmapDescriptor descriptor = buildIconDescriptor(item);
    if (descriptor != null) marker.setIcon(descriptor);
  }

  @Nullable
  private static BitmapDescriptor buildIconDescriptor(ReadableMap item) {
    String source = getString(item, "icon");
    if (source == null) source = getString(item, "image");
    if (source != null && source.length() > 0) {
      try {
        Uri uri = Uri.parse(source);
        String scheme = uri.getScheme();
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
          // Remote — handled async by loadRemoteMarkerIcon. Fall through to pin.
        } else if ("file".equals(scheme)) {
          return BitmapDescriptorFactory.fromPath(uri.getPath());
        } else {
          return BitmapDescriptorFactory.fromPath(source);
        }
      } catch (RuntimeException ignored) { /* fall through */ }
    }
    String pinColor = getString(item, "pinColor");
    if (pinColor != null) {
      return BitmapDescriptorFactory.defaultMarker(hueForColor(parseColor(pinColor, Color.RED)));
    }
    return null;
  }

  // static void showMarkerCallout(RNCustomMapView view, String markerId) {
  //   view.whenReady(() -> {
  //     Marker marker = view.markers.get(markerId);
  //     if (marker != null) {
  //       marker.showInfoWindow();
  //       view.selectedMarkerId = markerId;
  //       view.emitMarkerEvent("onMarkerSelect", marker);
  //     }
  //   });
  // }

  // static void hideMarkerCallout(RNCustomMapView view, String markerId) {
  //   view.whenReady(() -> {
  //     Marker marker = view.markers.get(markerId);
  //     if (marker != null) {
  //       marker.hideInfoWindow();
  //       if (markerId.equals(view.selectedMarkerId)) {
  //         view.selectedMarkerId = null;
  //       }
  //       view.emitMarkerEvent("onMarkerDeselect", marker);
  //     }
  //   });
  // }

  static void showMarkerCallout(RNCustomMapView view, String markerId) {
    if (view == null || markerId == null) return;
    view.whenReady(() -> {
        if (view.googleMap == null) return;
        Marker marker = view.markers.get(markerId);
        if (marker != null) {
            marker.showInfoWindow();
            view.selectedMarkerId = markerId;
            view.emitMarkerEvent("onMarkerSelect", marker);
        }
    });
  }

  static void hideMarkerCallout(RNCustomMapView view, String markerId) {
    if (view == null || markerId == null) return;
    view.whenReady(() -> {
        if (view.googleMap == null) return;
        Marker marker = view.markers.get(markerId);
        if (marker != null) {
            marker.hideInfoWindow();
            if (markerId.equals(view.selectedMarkerId)) {
                view.selectedMarkerId = null;
            }
            view.emitMarkerEvent("onMarkerDeselect", marker);
        }
    });
  }

  static void redrawMarker(RNCustomMapView view, String markerId) {
    view.whenReady(() -> {
      Marker marker = view.markers.get(markerId);
      if (marker != null && marker.isInfoWindowShown()) {
        marker.hideInfoWindow();
        marker.showInfoWindow();
      }
    });
  }

  static void animateMarkerToCoordinate(
      RNCustomMapView view,
      String markerId,
      ReadableMap coordinate,
      @Nullable ReadableMap options) {
    if (coordinate == null) {
      return;
    }
    view.whenReady(() -> {
      Marker marker = view.markers.get(markerId);
      if (marker == null) {
        return;
      }
      LatLng start = marker.getPosition();
      LatLng end = coordinate(coordinate);
      ValueAnimator animator = ValueAnimator.ofObject(new LatLngEvaluator(), start, end);
      animator.setDuration(Math.max((int) getDouble(options, "duration", 500d), 0));
      animator.setInterpolator(markerInterpolator(options));
      animator.addUpdateListener(animation -> {
        LatLng position = (LatLng) animation.getAnimatedValue();
        marker.setPosition(position);
        WritableMap payload = view.markerPayloads.get(markerId);
        if (payload != null) {
          WritableMap payloadCoordinate = Arguments.createMap();
          payloadCoordinate.putDouble("latitude", position.latitude);
          payloadCoordinate.putDouble("longitude", position.longitude);
          payload.putMap("coordinate", payloadCoordinate);
        }
      });
      animator.start();
    });
  }

  static void setMarkerView(RNCustomMapView mapView, String markerId, View markerView) {
    mapView.whenReady(() -> {
      Marker marker = mapView.markers.get(markerId);
      if (marker == null || markerView.getWidth() <= 0 || markerView.getHeight() <= 0) {
        return;
      }
      // ---------------------------------------------------------------
      // Issue 2 fix on Android: cache rendered snapshots by markerId +
      // size + subview signature so re-clustering at the same zoom level
      // re-uses the same Bitmap. Without the cache, every cluster
      // recompute repainted the bubble from the React view, briefly
      // showing the default GMS pin underneath.
      // ---------------------------------------------------------------
      String key = snapshotKey(markerId, markerView);
      Bitmap bitmap = getCachedIcon(key);
      if (bitmap == null || bitmap.isRecycled()) {
        bitmap = Bitmap.createBitmap(
            markerView.getWidth(),
            markerView.getHeight(),
            Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        markerView.draw(canvas);
        putCachedIcon(key, bitmap);
      }
      // Only call setIcon when the cache key actually changed — calling
      // setIcon with an identical descriptor still triggers a relayout
      // pass on the GMS marker and would re-introduce the brief flash.
      String previousKey = mapView.markerIconKeys.get(markerId);
      if (previousKey == null || !previousKey.equals(key)) {
        marker.setIcon(BitmapDescriptorFactory.fromBitmap(bitmap));
        marker.setAnchor(0.5f, 1f);
        mapView.markerIconKeys.put(markerId, key);
      }
    });
  }

  /**
   * Cheap content-signature for a marker snapshot. Same shape as the iOS
   * helper: size + (subview count, bounds, class) per child. The key
   * intentionally does NOT include the markerId so two different cluster
   * ids that render the same bubble share a single cached Bitmap — that's
   * what stops the "image disappears when single↔cluster" repaint on zoom.
   */
  private static String snapshotKey(@SuppressWarnings("unused") String markerId, View view) {
    int sig = 0;
    if (view instanceof android.view.ViewGroup) {
      android.view.ViewGroup group = (android.view.ViewGroup) view;
      sig = group.getChildCount();
      for (int i = 0; i < group.getChildCount(); i++) {
        View child = group.getChildAt(i);
        sig = sig * 31 + child.getWidth();
        sig = sig * 31 + child.getHeight();
        sig = sig * 31 + child.getClass().getName().hashCode();
      }
    }
    return "view:" + view.getWidth() + "x" + view.getHeight() + ":" + sig;
  }

  static void setPolylines(RNCustomMapView view, @Nullable ReadableArray polylines) {
    view.whenReady(() -> {
      for (Polyline polyline : view.polylines.values()) {
        polyline.remove();
      }
      view.polylines.clear();
      if (polylines == null) {
        return;
      }
      for (int i = 0; i < polylines.size(); i++) {
        ReadableMap item = polylines.getMap(i);
        PolylineOptions options = new PolylineOptions()
            .color(parseColor(getString(item, "strokeColor"), Color.BLUE))
            .width((float) getDouble(item, "strokeWidth", 1d))
            .geodesic(getBoolean(item, "geodesic", false))
            .zIndex((float) getDouble(item, "zIndex", 0d));
        ReadableArray coordinates = item.getArray("coordinates");
        for (int j = 0; coordinates != null && j < coordinates.size(); j++) {
          options.add(coordinate(coordinates.getMap(j)));
        }
        if (item.hasKey("lineDashPattern") && item.getType("lineDashPattern") == ReadableType.Array) {
          options.pattern(pattern(item.getArray("lineDashPattern")));
        }
        Polyline polyline = view.googleMap.addPolyline(options);
        polyline.setTag(getString(item, "id"));
        view.polylines.put(getString(item, "id"), polyline);
        if (getBoolean(item, "tappable", false)) {
          polyline.setClickable(true);
        }
      }
    });
  }

  static void setCircles(RNCustomMapView view, @Nullable ReadableArray circles) {
    view.whenReady(() -> {
      for (com.google.android.gms.maps.model.Circle circle : view.circles.values()) {
        circle.remove();
      }
      view.circles.clear();
      if (circles == null) {
        return;
      }
      for (int i = 0; i < circles.size(); i++) {
        ReadableMap item = circles.getMap(i);
        CircleOptions options = new CircleOptions()
            .center(coordinate(item.getMap("center")))
            .radius(item.getDouble("radius"))
            .strokeColor(parseColor(getString(item, "strokeColor"), Color.BLUE))
            .strokeWidth((float) getDouble(item, "strokeWidth", 1d))
            .fillColor(parseColor(getString(item, "fillColor"), Color.TRANSPARENT))
            .zIndex((float) getDouble(item, "zIndex", 0d));
        com.google.android.gms.maps.model.Circle circle = view.googleMap.addCircle(options);
        view.circles.put(getString(item, "id"), circle);
      }
    });
  }

  static void fitToCoordinates(RNCustomMapView view, ReadableArray coordinates, @Nullable ReadableMap options) {
    view.whenReady(() -> {
      LatLngBounds.Builder builder = new LatLngBounds.Builder();
      for (int i = 0; i < coordinates.size(); i++) {
        builder.include(coordinate(coordinates.getMap(i)));
      }
      boolean animated = options == null || !options.hasKey("animated") || options.getBoolean("animated");
      int padding = fitPadding(options);
      if (animated) {
        view.googleMap.animateCamera(CameraUpdateFactory.newLatLngBounds(builder.build(), padding));
      } else {
        view.googleMap.moveCamera(CameraUpdateFactory.newLatLngBounds(builder.build(), padding));
      }
    });
  }

  static void fitToElements(RNCustomMapView view, @Nullable ReadableMap options) {
    view.whenReady(() -> {
      if (view.markers.isEmpty()) {
        return;
      }
      LatLngBounds.Builder builder = new LatLngBounds.Builder();
      for (Marker marker : view.markers.values()) {
        builder.include(marker.getPosition());
      }
      moveToBounds(view, builder.build(), options);
    });
  }

  static void fitToSuppliedMarkers(RNCustomMapView view, ReadableArray markerIds, @Nullable ReadableMap options) {
    view.whenReady(() -> {
      if (markerIds == null || markerIds.size() == 0) {
        return;
      }
      LatLngBounds.Builder builder = new LatLngBounds.Builder();
      boolean hasMarker = false;
      for (int i = 0; i < markerIds.size(); i++) {
        String markerId = markerIds.getString(i);
        Marker marker = view.markers.get(markerId);
        if (marker != null) {
          builder.include(marker.getPosition());
          hasMarker = true;
        }
      }
      if (hasMarker) {
        moveToBounds(view, builder.build(), options);
      }
    });
  }

  private static void moveToBounds(RNCustomMapView view, LatLngBounds bounds, @Nullable ReadableMap options) {
    boolean animated = options == null || !options.hasKey("animated") || options.getBoolean("animated");
    int[] edgePadding = edgePadding(options);
    if (edgePadding != null) {
      view.googleMap.setPadding(edgePadding[3], edgePadding[0], edgePadding[1], edgePadding[2]);
      if (animated) {
        view.googleMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, 0), new GoogleMap.CancelableCallback() {
          @Override public void onFinish() { view.googleMap.setPadding(0, 0, 0, 0); }
          @Override public void onCancel() { view.googleMap.setPadding(0, 0, 0, 0); }
        });
      } else {
        view.googleMap.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, 0));
        view.googleMap.setPadding(0, 0, 0, 0);
      }
      return;
    }
    int padding = fitPadding(options);
    if (animated) {
      view.googleMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, padding));
    } else {
      view.googleMap.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, padding));
    }
  }

  @Nullable
  private static int[] edgePadding(@Nullable ReadableMap options) {
    if (options == null || !options.hasKey("edgePadding") || options.isNull("edgePadding")) {
      return null;
    }
    ReadableMap edge = options.getMap("edgePadding");
    return new int[] {
        (int) getDouble(edge, "top", 0),
        (int) getDouble(edge, "right", 0),
        (int) getDouble(edge, "bottom", 0),
        (int) getDouble(edge, "left", 0)
    };
  }

  private static int fitPadding(@Nullable ReadableMap options) {
    if (options == null) {
      return 50;
    }
    return (int) getDouble(options, "padding", 50d);
  }
  static WritableMap camera(RNCustomMapView view) {
    WritableMap out = Arguments.createMap();
    if (view.googleMap == null) {
      return out;
    }
    com.google.android.gms.maps.model.CameraPosition position = view.googleMap.getCameraPosition();
    WritableMap center = Arguments.createMap();
    center.putDouble("latitude", position.target.latitude);
    center.putDouble("longitude", position.target.longitude);
    out.putMap("center", center);
    out.putDouble("pitch", position.tilt);
    out.putDouble("heading", position.bearing);
    out.putDouble("zoom", position.zoom);
    return out;
  }

  static WritableArray markers(RNCustomMapView view) {
    WritableArray array = Arguments.createArray();
    for (WritableMap marker : view.markerPayloads.values()) {
      array.pushMap(marker.copy());
    }
    return array;
  }

  private static WritableMap markerPayload(String id, ReadableMap item) {
    WritableMap payload = Arguments.createMap();
    WritableMap coordinate = Arguments.createMap();
    coordinate.putDouble("latitude", item.getDouble("latitude"));
    coordinate.putDouble("longitude", item.getDouble("longitude"));
    payload.putString("id", id);
    payload.putMap("coordinate", coordinate);
    payload.putString("title", getString(item, "title"));
    payload.putString("description", getString(item, "description"));
    return payload;
  }

  private static LatLng coordinate(ReadableMap map) {
    return new LatLng(map.getDouble("latitude"), map.getDouble("longitude"));
  }

  private static float zoomFromDelta(double longitudeDelta) {
    return (float) Math.max(0, Math.min(21, Math.log(360d / longitudeDelta) / Math.log(2d)));
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

  private static int parseColor(@Nullable String color, int fallback) {
    if (color == null) {
      return fallback;
    }
    color = color.trim();
    try {
      if (color.startsWith("rgba(") && color.endsWith(")")) {
        String[] parts = color.substring(5, color.length() - 1).split(",");
        if (parts.length == 4) {
          int red = clampColor(Integer.parseInt(parts[0].trim()));
          int green = clampColor(Integer.parseInt(parts[1].trim()));
          int blue = clampColor(Integer.parseInt(parts[2].trim()));
          String alphaPart = parts[3].trim();
          int alpha = alphaPart.contains(".")
              ? clampColor((int) Math.round(Double.parseDouble(alphaPart) * 255d))
              : clampColor(Integer.parseInt(alphaPart));
          return Color.argb(alpha, red, green, blue);
        }
      }
      if (color.startsWith("rgb(") && color.endsWith(")")) {
        String[] parts = color.substring(4, color.length() - 1).split(",");
        if (parts.length == 3) {
          return Color.rgb(
              clampColor(Integer.parseInt(parts[0].trim())),
              clampColor(Integer.parseInt(parts[1].trim())),
              clampColor(Integer.parseInt(parts[2].trim())));
        }
      }
      if (color.startsWith("#") && color.length() == 9) {
        String rgba = color.substring(1);
        return Color.parseColor("#" + rgba.substring(6, 8) + rgba.substring(0, 6));
      }
      return Color.parseColor(color);
    } catch (RuntimeException ignored) {
      return fallback;
    }
  }

  private static int clampColor(int value) {
    return Math.max(0, Math.min(255, value));
  }

  private static void applyAnchor(MarkerOptions options, ReadableMap item) {
    options.anchor(0.5f, 1f);
    if (item.hasKey("anchor") && !item.isNull("anchor")) {
      ReadableMap anchor = item.getMap("anchor");
      options.anchor((float) getDouble(anchor, "x", 0.5d), (float) getDouble(anchor, "y", 1d));
    }
    ReadableMap calloutAnchor = null;
    if (item.hasKey("calloutAnchor") && !item.isNull("calloutAnchor")) {
      calloutAnchor = item.getMap("calloutAnchor");
    } else if (item.hasKey("calloutOffset") && !item.isNull("calloutOffset")) {
      calloutAnchor = item.getMap("calloutOffset");
    }
    if (calloutAnchor != null) {
      options.infoWindowAnchor((float) getDouble(calloutAnchor, "x", 0.5d), (float) getDouble(calloutAnchor, "y", 0d));
    }
  }

  private static void applyInitialMarkerIcon(MarkerOptions options, ReadableMap item) {
    applyInitialMarkerIcon(options, item, true);
  }

  /**
   * @param useCachedRemote when true, a previously fetched remote icon is
   *   applied synchronously from the bitmap cache so the marker spawns with
   *   its custom icon already painted. Eliminates the "default pin flash"
   *   when a clustered marker reappears at a familiar zoom level.
   */
  private static void applyInitialMarkerIcon(MarkerOptions options, ReadableMap item, boolean useCachedRemote) {
    String source = getString(item, "icon");
    if (source == null) {
      source = getString(item, "image");
    }
    if (source != null && source.length() > 0) {
      try {
        Uri uri = Uri.parse(source);
        String scheme = uri.getScheme();
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
          if (useCachedRemote) {
            Bitmap cached = getCachedIcon("src:" + source);
            if (cached != null && !cached.isRecycled()) {
              options.icon(BitmapDescriptorFactory.fromBitmap(cached));
              return;
            }
          }
          maybeApplyClusterPlaceholder(options, item);
          if (options.getIcon() == null) applyPinColor(options, item);
          return;
        }
        if ("file".equals(uri.getScheme())) {
          options.icon(BitmapDescriptorFactory.fromPath(uri.getPath()));
        } else {
          options.icon(BitmapDescriptorFactory.fromPath(source));
        }
        return;
      } catch (RuntimeException ignored) {
        // Fall back to pin color/default marker.
      }
    }
    maybeApplyClusterPlaceholder(options, item);
    if (options.getIcon() == null) applyPinColor(options, item);
  }

  /**
   * Cluster synthetic markers have no icon/pinColor — their visual is
   * supplied a frame later via setMarkerView. Spawn them with a transparent
   * 1×1 placeholder so the GMS default pin never flashes through during
   * that one-frame window (Issue 2). Mirrors the iOS placeholder behavior.
   */
  private static void maybeApplyClusterPlaceholder(MarkerOptions options, ReadableMap item) {
    String id = getString(item, "id");
    String pinColor = getString(item, "pinColor");
    if (id != null && id.startsWith("cluster:") && (pinColor == null || pinColor.length() == 0)) {
      options.icon(BitmapDescriptorFactory.fromBitmap(transparentPlaceholderBitmap()));
    }
  }

  private static Bitmap sTransparentPlaceholder;
  private static synchronized Bitmap transparentPlaceholderBitmap() {
    if (sTransparentPlaceholder == null || sTransparentPlaceholder.isRecycled()) {
      sTransparentPlaceholder = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
      // ARGB_8888 buffers start zeroed → fully transparent.
    }
    return sTransparentPlaceholder;
  }

  private static void applyPinColor(MarkerOptions options, ReadableMap item) {
    String pinColor = getString(item, "pinColor");
    if (pinColor != null) {
      options.icon(BitmapDescriptorFactory.defaultMarker(hueForColor(parseColor(pinColor, Color.RED))));
    }
  }

  private static void loadRemoteMarkerIcon(RNCustomMapView view, Marker marker, String markerId, ReadableMap item) {
    String source = getString(item, "icon");
    if (source == null) {
      source = getString(item, "image");
    }
    if (source == null) {
      return;
    }
    Uri uri = Uri.parse(source);
    String scheme = uri.getScheme();
    if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
      return;
    }
    // Fast path: bitmap already cached from an earlier load anywhere on the
    // map. Apply synchronously and skip the network fetch — this is what
    // makes clustered markers re-appear with their custom icon instantly.
    final String cacheKey = "src:" + source;
    Bitmap cached = getCachedIcon(cacheKey);
    if (cached != null && !cached.isRecycled()) {
      marker.setIcon(BitmapDescriptorFactory.fromBitmap(cached));
      marker.setAnchor(0.5f, 1f);
      return;
    }
    final String finalSource = source;
    CustomTarget<Bitmap> target = new CustomTarget<Bitmap>() {
      @Override
      public void onResourceReady(Bitmap resource, @Nullable Transition<? super Bitmap> transition) {
        putCachedIcon(cacheKey, resource);
        // Marker may have been removed during the async fetch — only update
        // the marker if it's still tracked. The Bitmap is still cached for
        // future re-appearances either way.
        if (view.markers.get(markerId) == marker) {
          marker.setIcon(BitmapDescriptorFactory.fromBitmap(resource));
          marker.setAnchor(0.5f, 1f);
        }
        view.markerIconTargets.remove(markerId);
      }

      @Override
      public void onLoadCleared(@Nullable android.graphics.drawable.Drawable placeholder) {
        view.markerIconTargets.remove(markerId);
      }
    };
    view.markerIconTargets.put(markerId, target);
    Glide.with(view).asBitmap().load(finalSource).into(target);
  }

  private static Interpolator markerInterpolator(@Nullable ReadableMap options) {
    String name = getString(options, "interpolator");
    if (name == null) {
      name = getString(options, "easing");
    }
    if ("linear".equals(name)) {
      return new LinearInterpolator();
    }
    if ("accelerate".equals(name) || "easeIn".equals(name)) {
      return new AccelerateInterpolator();
    }
    if ("decelerate".equals(name) || "easeOut".equals(name)) {
      return new DecelerateInterpolator();
    }
    return new AccelerateDecelerateInterpolator();
  }

  private static float hueForColor(int color) {
    float[] hsv = new float[3];
    Color.colorToHSV(color, hsv);
    return hsv[0];
  }

  private static List<PatternItem> pattern(@Nullable ReadableArray values) {
    List<PatternItem> items = new ArrayList<>();
    if (values == null) {
      return items;
    }
    for (int i = 0; i < values.size(); i++) {
      float length = (float) values.getDouble(i);
      items.add(i % 2 == 0 ? new Dash(length) : new Gap(length));
    }
    return items;
  }

  private static final class LatLngEvaluator implements TypeEvaluator<LatLng> {
    @Override
    public LatLng evaluate(float fraction, LatLng startValue, LatLng endValue) {
      double latitude = startValue.latitude + ((endValue.latitude - startValue.latitude) * fraction);
      double longitudeDelta = endValue.longitude - startValue.longitude;
      if (Math.abs(longitudeDelta) > 180) {
        longitudeDelta -= Math.signum(longitudeDelta) * 360;
      }
      double longitude = startValue.longitude + (longitudeDelta * fraction);
      return new LatLng(latitude, longitude);
    }
  }
}
