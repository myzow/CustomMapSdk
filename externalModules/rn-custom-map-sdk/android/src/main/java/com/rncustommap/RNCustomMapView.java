package com.rncustommap;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.events.RCTEventEmitter;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.MapView;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.model.CameraPosition;
import com.google.android.gms.maps.model.Circle;
import com.google.android.gms.maps.model.CircleOptions;
import com.google.android.gms.maps.model.Dash;
import com.google.android.gms.maps.model.Gap;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.maps.model.Polyline;
import com.google.android.gms.maps.model.PolylineOptions;
import com.bumptech.glide.request.target.CustomTarget;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class RNCustomMapView extends FrameLayout implements OnMapReadyCallback {
  final MapView mapView;
  @Nullable GoogleMap googleMap;
  final Map<String, Marker> markers = new HashMap<>();
  final Map<String, Polyline> polylines = new HashMap<>();
  final Map<String, Circle> circles = new HashMap<>();
  final Map<String, WritableMap> markerPayloads = new HashMap<>();
  final Map<String, Boolean> markerTappables = new HashMap<>();
  final Map<String, CustomTarget<android.graphics.Bitmap>> markerIconTargets = new HashMap<>();
  private final List<Runnable> pending = new ArrayList<>();
  @Nullable String selectedMarkerId;
  private boolean lastRegionChangeWasGesture = false;
  private boolean initialRegionApplied = false;
  private float minZoom = 0f;
  private float maxZoom = 21f;

  public RNCustomMapView(ReactContext context) {
    super(context);
    mapView = new MapView(context);
    mapView.onCreate(null);
    mapView.onStart();
    mapView.onResume();
    addView(mapView, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    mapView.getMapAsync(this);
  }

  @Override
  protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
    super.onLayout(changed, left, top, right, bottom);
    mapView.layout(0, 0, right - left, bottom - top);
  }

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
    map.setOnMyLocationChangeListener(location -> emitUserLocation(location));
    map.setMinZoomPreference(minZoom);
    map.setMaxZoomPreference(maxZoom);
    for (Runnable runnable : pending) {
      runnable.run();
    }
    pending.clear();
    emitEmpty("onMapReady");
  }

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

  void destroy() {
    mapView.onPause();
    mapView.onStop();
    mapView.onDestroy();
  }

  @Override
  public boolean dispatchTouchEvent(MotionEvent event) {
    requestDisallowInterceptTouchEvent(true);
    return super.dispatchTouchEvent(event);
  }

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
    ((ReactContext) getContext())
        .getJSModule(RCTEventEmitter.class)
        .receiveEvent(getId(), eventName, event);
  }
}
