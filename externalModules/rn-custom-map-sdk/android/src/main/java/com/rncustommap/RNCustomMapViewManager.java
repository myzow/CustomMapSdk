package com.rncustommap;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.common.MapBuilder;
import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;
import java.util.Map;

public class RNCustomMapViewManager extends SimpleViewManager<RNCustomMapView> {
  public static final String REACT_CLASS = "RNCustomMapView";
  private final ReactApplicationContext reactContext;

  public RNCustomMapViewManager(ReactApplicationContext reactContext) {
    this.reactContext = reactContext;
  }

  @NonNull
  @Override
  public String getName() {
    return REACT_CLASS;
  }

  @NonNull
  @Override
  protected RNCustomMapView createViewInstance(@NonNull ThemedReactContext context) {
    RNCustomMapView view = new RNCustomMapView(context);
    RNCustomMapViewManagerImpl.register(view);
    return view;
  }

  @Override
  public void onDropViewInstance(@NonNull RNCustomMapView view) {
    RNCustomMapViewManagerImpl.unregister(view);
    view.destroy();
    super.onDropViewInstance(view);
  }

  @Nullable
  @Override
  public Map<String, Object> getExportedCustomBubblingEventTypeConstants() {
    return MapBuilder.<String, Object>builder()
        .put("onPress", event("onPress"))
        .put("onLongPress", event("onLongPress"))
        .put("onMarkerPress", event("onMarkerPress"))
        .put("onMarkerSelect", event("onMarkerSelect"))
        .put("onMarkerDeselect", event("onMarkerDeselect"))
        .put("onMarkerDragStart", event("onMarkerDragStart"))
        .put("onMarkerDrag", event("onMarkerDrag"))
        .put("onMarkerDragEnd", event("onMarkerDragEnd"))
        .put("onCalloutPress", event("onCalloutPress"))
        .put("onPolylinePress", event("onPolylinePress"))
        .build();
  }

  @Nullable
  @Override
  public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
    return MapBuilder.<String, Object>builder()
        .put("onRegionChange", directEvent("onRegionChange"))
        .put("onRegionChangeComplete", directEvent("onRegionChangeComplete"))
        .put("onMapReady", directEvent("onMapReady"))
        .put("onUserLocationChange", directEvent("onUserLocationChange"))
        .build();
  }

  private Map<String, Object> event(String name) {
    return MapBuilder.of("phasedRegistrationNames", MapBuilder.of("bubbled", name));
  }

  private Map<String, Object> directEvent(String name) {
    return MapBuilder.of("registrationName", name);
  }

  @ReactProp(name = "region")
  public void setRegion(RNCustomMapView view, @Nullable ReadableMap region) {
    RNCustomMapViewManagerImpl.setRegion(view, region, false);
  }

  @ReactProp(name = "initialRegion")
  public void setInitialRegion(RNCustomMapView view, @Nullable ReadableMap region) {
    RNCustomMapViewManagerImpl.setRegion(view, region, true);
  }

  @ReactProp(name = "camera")
  public void setCamera(RNCustomMapView view, @Nullable ReadableMap camera) {
    RNCustomMapViewManagerImpl.setCamera(view, camera, 0);
  }

  @ReactProp(name = "provider")
  public void setProvider(RNCustomMapView view, @Nullable String provider) {
    RNCustomMapViewManagerImpl.setProvider(view, provider);
  }

  @ReactProp(name = "mapType")
  public void setMapType(RNCustomMapView view, @Nullable String mapType) {
    RNCustomMapViewManagerImpl.setMapType(view, mapType);
  }

  @ReactProp(name = "customMapStyle")
  public void setCustomMapStyle(RNCustomMapView view, @Nullable String style) {
    RNCustomMapViewManagerImpl.setCustomMapStyle(view, style);
  }

  @ReactProp(name = "showsUserLocation", defaultBoolean = false)
  public void setShowsUserLocation(RNCustomMapView view, boolean enabled) {
    RNCustomMapViewManagerImpl.setShowsUserLocation(view, enabled);
  }

  @ReactProp(name = "zoomEnabled", defaultBoolean = true)
  public void setZoomEnabled(RNCustomMapView view, boolean enabled) {
    view.setZoomEnabled(enabled);
  }

  @ReactProp(name = "scrollEnabled", defaultBoolean = true)
  public void setScrollEnabled(RNCustomMapView view, boolean enabled) {
    view.setScrollEnabled(enabled);
  }

  @ReactProp(name = "rotateEnabled", defaultBoolean = true)
  public void setRotateEnabled(RNCustomMapView view, boolean enabled) {
    view.setRotateEnabled(enabled);
  }

  @ReactProp(name = "pitchEnabled", defaultBoolean = true)
  public void setPitchEnabled(RNCustomMapView view, boolean enabled) {
    view.setPitchEnabled(enabled);
  }

  @ReactProp(name = "minZoomLevel")
  public void setMinZoomLevel(RNCustomMapView view, float value) {
    view.setMinZoomLevel(value);
  }

  @ReactProp(name = "maxZoomLevel")
  public void setMaxZoomLevel(RNCustomMapView view, float value) {
    view.setMaxZoomLevel(value);
  }

  @ReactProp(name = "markers")
  public void setMarkers(RNCustomMapView view, @Nullable ReadableArray markers) {
    RNCustomMapViewManagerImpl.setMarkers(view, markers);
  }

  @ReactProp(name = "polylines")
  public void setPolylines(RNCustomMapView view, @Nullable ReadableArray polylines) {
    RNCustomMapViewManagerImpl.setPolylines(view, polylines);
  }

  @ReactProp(name = "circles")
  public void setCircles(RNCustomMapView view, @Nullable ReadableArray circles) {
    RNCustomMapViewManagerImpl.setCircles(view, circles);
  }
}
