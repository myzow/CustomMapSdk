package com.rncustommap;

import android.animation.TypeEvaluator;
import android.animation.ValueAnimator;
import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
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
      for (Marker marker : view.markers.values()) {
        marker.remove();
      }
      view.markers.clear();
      view.markerPayloads.clear();
      view.markerTappables.clear();
      view.markerIconTargets.clear();

      if (markers == null) {
        return;
      }
      for (int i = 0; i < markers.size(); i++) {
        ReadableMap item = markers.getMap(i);
        String id = item.hasKey("id") ? item.getString("id") : "marker-" + i;
        MarkerOptions options = new MarkerOptions()
            .position(new LatLng(item.getDouble("latitude"), item.getDouble("longitude")))
            .title(getString(item, "title"))
            .snippet(getString(item, "description"))
            .draggable(getBoolean(item, "draggable", false))
            .flat(getBoolean(item, "flat", false))
            .rotation((float) getDouble(item, "rotation", 0d))
            .alpha((float) getDouble(item, "opacity", 1d));
        applyAnchor(options, item);
        applyInitialMarkerIcon(options, item);
        Marker marker = view.googleMap.addMarker(options);
        if (marker != null) {
          marker.setTag(id);
          view.markers.put(id, marker);
          view.markerPayloads.put(id, markerPayload(id, item));
          view.markerTappables.put(id, getBoolean(item, "tappable", true));
          loadRemoteMarkerIcon(view, marker, id, item);
        }
      }
    });
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
      Bitmap bitmap = Bitmap.createBitmap(
          markerView.getWidth(),
          markerView.getHeight(),
          Bitmap.Config.ARGB_8888);
      Canvas canvas = new Canvas(bitmap);
      markerView.draw(canvas);
      marker.setIcon(BitmapDescriptorFactory.fromBitmap(bitmap));
      marker.setAnchor(0.5f, 1f);
    });
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
    String source = getString(item, "icon");
    if (source == null) {
      source = getString(item, "image");
    }
    if (source != null && source.length() > 0) {
      try {
        Uri uri = Uri.parse(source);
        String scheme = uri.getScheme();
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
          applyPinColor(options, item);
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
    applyPinColor(options, item);
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
    CustomTarget<Bitmap> target = new CustomTarget<Bitmap>() {
      @Override
      public void onResourceReady(Bitmap resource, @Nullable Transition<? super Bitmap> transition) {
        marker.setIcon(BitmapDescriptorFactory.fromBitmap(resource));
        marker.setAnchor(0.5f, 1f);
        view.markerIconTargets.remove(markerId);
      }

      @Override
      public void onLoadCleared(@Nullable android.graphics.drawable.Drawable placeholder) {
        view.markerIconTargets.remove(markerId);
      }
    };
    view.markerIconTargets.put(markerId, target);
    Glide.with(view).asBitmap().load(source).into(target);
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
