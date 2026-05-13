package com.rncustommap;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.UIManager;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.uimanager.UIManagerHelper;
import android.view.View;

@ReactModule(name = RNCustomMapModule.NAME)
public class RNCustomMapModule extends NativeRNCustomMapViewManagerSpec {
  public static final String NAME = NativeRNCustomMapViewManagerSpec.NAME;

  public RNCustomMapModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @Override
  public void animateToRegion(double reactTag, ReadableMap region, double duration) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view != null) {
      RNCustomMapViewManagerImpl.setRegion(view, region, false);
    }
  }

  @Override
  public void animateToCoordinate(double reactTag, ReadableMap coordinate, double duration) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view != null) {
      com.facebook.react.bridge.WritableNativeMap camera = new com.facebook.react.bridge.WritableNativeMap();
      camera.putMap("center", coordinate);
      camera.putDouble("zoom", view.googleMap == null ? 12d : view.googleMap.getCameraPosition().zoom);
      RNCustomMapViewManagerImpl.setCamera(view, camera, (int) duration);
    }
  }

  @Override
  public void fitToCoordinates(double reactTag, ReadableArray coordinates, @Nullable ReadableMap options) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view != null) {
      RNCustomMapViewManagerImpl.fitToCoordinates(view, coordinates, options);
    }
  }

  @Override
  public void fitToElements(double reactTag, @Nullable ReadableMap options) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view != null) {
      RNCustomMapViewManagerImpl.fitToElements(view, options);
    }
  }

  @Override
  public void fitToSuppliedMarkers(double reactTag, ReadableArray markerIds, @Nullable ReadableMap options) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view != null) {
      RNCustomMapViewManagerImpl.fitToSuppliedMarkers(view, markerIds, options);
    }
  }

  @Override
  public void getCamera(double reactTag, Promise promise) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view == null) {
      promise.reject("E_NO_VIEW", "RNCustomMapView not found");
    } else {
      promise.resolve(RNCustomMapViewManagerImpl.camera(view));
    }
  }

  @Override
  public void setCamera(double reactTag, ReadableMap camera, double duration) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view != null) {
      RNCustomMapViewManagerImpl.setCamera(view, camera, (int) duration);
    }
  }

  @Override
  public void getMarkers(double reactTag, Promise promise) {
    RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
    if (view == null) {
      promise.reject("E_NO_VIEW", "RNCustomMapView not found");
    } else {
      promise.resolve(RNCustomMapViewManagerImpl.markers(view));
    }
  }

  // @Override
  // public void showMarkerCallout(double reactTag, String markerId) {
  //   RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
  //   if (view != null) {
  //     RNCustomMapViewManagerImpl.showMarkerCallout(view, markerId);
  //   }
  // }

  // @Override
  // public void hideMarkerCallout(double reactTag, String markerId) {
  //   RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
  //   if (view != null) {
  //     RNCustomMapViewManagerImpl.hideMarkerCallout(view, markerId);
  //   }
  // }

  // @Override
  // public void redrawMarker(double reactTag, String markerId) {
  //   RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
  //   if (view != null) {
  //     RNCustomMapViewManagerImpl.redrawMarker(view, markerId);
  //   }
  // }

  // @Override
  // public void animateMarkerToCoordinate(
  //     double reactTag,
  //     String markerId,
  //     ReadableMap coordinate,
  //     @Nullable ReadableMap options) {
  //   RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
  //   if (view != null) {
  //     RNCustomMapViewManagerImpl.animateMarkerToCoordinate(view, markerId, coordinate, options);
  //   }
  // }

  @Override
  public void showMarkerCallout(double reactTag, String markerId) {
      RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
      if (view != null && markerId != null && !markerId.isEmpty()) {
          RNCustomMapViewManagerImpl.showMarkerCallout(view, markerId);
      } else {
          Log.e("RNCustomMapModule", "showMarkerCallout failed: view or markerId null");
      }
  }

  @Override
  public void hideMarkerCallout(double reactTag, String markerId) {
      RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
      if (view != null && markerId != null && !markerId.isEmpty()) {
          RNCustomMapViewManagerImpl.hideMarkerCallout(view, markerId);
      }
  }

  @Override
  public void redrawMarker(double reactTag, String markerId) {
      RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
      if (view != null && markerId != null && !markerId.isEmpty()) {
          RNCustomMapViewManagerImpl.redrawMarker(view, markerId);
      }
  }

  @Override
  public void animateMarkerToCoordinate(
      double reactTag,
      String markerId,
      ReadableMap coordinate,
      @Nullable ReadableMap options) {
      RNCustomMapView view = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
      if (view != null && markerId != null && !markerId.isEmpty() && coordinate != null) {
          RNCustomMapViewManagerImpl.animateMarkerToCoordinate(view, markerId, coordinate, options);
      }
  }

  @Override
  public void setMarkerView(double reactTag, String markerId, double markerViewTag) {
    UiThreadUtil.runOnUiThread(() -> {
      RNCustomMapView mapView = RNCustomMapViewManagerImpl.findViewByTag((int) reactTag);
      if (mapView == null) {
        return;
      }
      UIManager uiManager = UIManagerHelper.getUIManagerForReactTag(getReactApplicationContext(), (int) markerViewTag);
      if (uiManager == null) {
        return;
      }
      View markerView = uiManager.resolveView((int) markerViewTag);
      if (markerView != null) {
        RNCustomMapViewManagerImpl.setMarkerView(mapView, markerId, markerView);
      }
    });
  }
}
