#import "RNCustomMapViewManager.h"
#import "RNCustomMapView.h"
#import <React/RCTBridge.h>
#import <React/RCTConvert.h>
#import <React/RCTUIManager.h>

@implementation RNCustomMapViewManager

RCT_EXPORT_MODULE(RNCustomMapView)

- (UIView *)view
{
  return [RNCustomMapNativeView new];
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

RCT_EXPORT_VIEW_PROPERTY(onPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onLongPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onRegionChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onRegionChangeComplete, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMapReady, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onUserLocationChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMarkerPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMarkerSelect, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMarkerDeselect, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMarkerDragStart, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMarkerDrag, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onMarkerDragEnd, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCalloutPress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPolylinePress, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(markers, NSArray)
RCT_EXPORT_VIEW_PROPERTY(polylines, NSArray)
RCT_EXPORT_VIEW_PROPERTY(circles, NSArray)

RCT_CUSTOM_VIEW_PROPERTY(region, NSDictionary, RNCustomMapNativeView)
{
  if (json) {
    [view animateToRegion:json duration:0];
  }
}

RCT_CUSTOM_VIEW_PROPERTY(initialRegion, NSDictionary, RNCustomMapNativeView)
{
  if (json && !view.initialRegionApplied) {
    view.initialRegionApplied = YES;
    [view animateToRegion:json duration:0];
  }
}

RCT_CUSTOM_VIEW_PROPERTY(camera, NSDictionary, RNCustomMapNativeView)
{
  if (json) {
    [view setCamera:json duration:0];
  }
}

RCT_CUSTOM_VIEW_PROPERTY(provider, NSString, RNCustomMapNativeView)
{
  [view setProvider:json ?: @"google"];
}

RCT_CUSTOM_VIEW_PROPERTY(mapType, NSString, RNCustomMapNativeView)
{
  [view setMapTypeString:json ?: @"standard"];
}

RCT_CUSTOM_VIEW_PROPERTY(showsUserLocation, BOOL, RNCustomMapNativeView)
{
  [view setShowsUserLocation:json ? [RCTConvert BOOL:json] : NO];
}

RCT_CUSTOM_VIEW_PROPERTY(zoomEnabled, BOOL, RNCustomMapNativeView)
{
  [view setZoomEnabled:json ? [RCTConvert BOOL:json] : YES];
}

RCT_CUSTOM_VIEW_PROPERTY(scrollEnabled, BOOL, RNCustomMapNativeView)
{
  [view setScrollEnabled:json ? [RCTConvert BOOL:json] : YES];
}

RCT_CUSTOM_VIEW_PROPERTY(rotateEnabled, BOOL, RNCustomMapNativeView)
{
  [view setRotateEnabled:json ? [RCTConvert BOOL:json] : YES];
}

RCT_CUSTOM_VIEW_PROPERTY(pitchEnabled, BOOL, RNCustomMapNativeView)
{
  [view setPitchEnabled:json ? [RCTConvert BOOL:json] : YES];
}

RCT_CUSTOM_VIEW_PROPERTY(customMapStyle, NSString, RNCustomMapNativeView)
{
  [view setCustomMapStyle:json];
}

RCT_CUSTOM_VIEW_PROPERTY(minZoomLevel, NSNumber, RNCustomMapNativeView)
{
  [view setMinZoomLevel:json];
}

RCT_CUSTOM_VIEW_PROPERTY(maxZoomLevel, NSNumber, RNCustomMapNativeView)
{
  [view setMaxZoomLevel:json];
}

@end
