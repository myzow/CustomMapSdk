#import "RNCustomMapModule.h"
#import "RNCustomMapView.h"
#import <React/RCTBridge.h>
#import <React/RCTUIManager.h>

@implementation RNCustomMapModule

RCT_EXPORT_MODULE(RNCustomMapViewManager)

@synthesize bridge = _bridge;

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(animateToRegion:(nonnull NSNumber *)reactTag region:(NSDictionary *)region duration:(nonnull NSNumber *)duration)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view animateToRegion:region duration:duration.integerValue];
  }];
}

RCT_EXPORT_METHOD(animateToCoordinate:(nonnull NSNumber *)reactTag coordinate:(NSDictionary *)coordinate duration:(nonnull NSNumber *)duration)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view animateToCoordinate:coordinate duration:duration.integerValue];
  }];
}

RCT_EXPORT_METHOD(fitToCoordinates:(nonnull NSNumber *)reactTag coordinates:(NSArray *)coordinates options:(NSDictionary *)options)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view fitToCoordinates:coordinates options:options ?: @{}];
  }];
}

RCT_EXPORT_METHOD(fitToElements:(nonnull NSNumber *)reactTag options:(NSDictionary *)options)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view fitToElements:options ?: @{}];
  }];
}

RCT_EXPORT_METHOD(fitToSuppliedMarkers:(nonnull NSNumber *)reactTag markerIds:(NSArray *)markerIds options:(NSDictionary *)options)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view fitToSuppliedMarkers:markerIds options:options ?: @{}];
  }];
}

RCT_EXPORT_METHOD(getCamera:(nonnull NSNumber *)reactTag resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    resolve([view currentCamera]);
  }];
}

RCT_EXPORT_METHOD(setCamera:(nonnull NSNumber *)reactTag camera:(NSDictionary *)camera duration:(nonnull NSNumber *)duration)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view setCamera:camera duration:duration.integerValue];
  }];
}

RCT_EXPORT_METHOD(getMarkers:(nonnull NSNumber *)reactTag resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    resolve([view currentMarkers]);
  }];
}

RCT_EXPORT_METHOD(showMarkerCallout:(nonnull NSNumber *)reactTag markerId:(NSString *)markerId)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view showMarkerCallout:markerId];
  }];
}

RCT_EXPORT_METHOD(hideMarkerCallout:(nonnull NSNumber *)reactTag markerId:(NSString *)markerId)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view hideMarkerCallout:markerId];
  }];
}

RCT_EXPORT_METHOD(redrawMarker:(nonnull NSNumber *)reactTag markerId:(NSString *)markerId)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view redrawMarker:markerId];
  }];
}

RCT_EXPORT_METHOD(animateMarkerToCoordinate:(nonnull NSNumber *)reactTag markerId:(NSString *)markerId coordinate:(NSDictionary *)coordinate options:(NSDictionary *)options)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view animateMarkerToCoordinate:markerId coordinate:coordinate options:options ?: @{}];
  }];
}

RCT_EXPORT_METHOD(setMarkerView:(nonnull NSNumber *)reactTag markerId:(NSString *)markerId markerViewTag:(nonnull NSNumber *)markerViewTag)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *markerView = [self.bridge.uiManager viewForReactTag:markerViewTag];
    if (!markerView) {
      return;
    }
    [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
      [view setMarkerView:markerView markerId:markerId];
    }];
  });
}

RCT_EXPORT_METHOD(setAdvancedMarkerView:(nonnull NSNumber *)reactTag markerId:(NSString *)markerId markerViewTag:(nonnull NSNumber *)markerViewTag)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    // -1 is the agreed-upon release sentinel — sent by JS when React
    // unmounts the snapshot view. Forward as nil so the native view
    // detaches its iconView reference BEFORE RN deallocates the
    // underlying UIView (prevents the "view has been unmounted" crash).
    if (markerViewTag.integerValue < 0) {
      [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
        [view setAdvancedMarkerView:nil markerId:markerId];
      }];
      return;
    }
    UIView *markerView = [self.bridge.uiManager viewForReactTag:markerViewTag];
    if (!markerView) {
      return;
    }
    [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
      [view setAdvancedMarkerView:markerView markerId:markerId];
    }];
  });
}

// Lifecycle commands are Android-only — no-op on iOS (MapKit/GMS-iOS does
// not exhibit the bottom-tab white-screen bug), but exposed for cross-platform
// JS calls to remain symmetric.
RCT_EXPORT_METHOD(setActive:(nonnull NSNumber *)reactTag active:(BOOL)active) {}
RCT_EXPORT_METHOD(forceRedraw:(nonnull NSNumber *)reactTag) {}

RCT_EXPORT_METHOD(computeClusters:(nonnull NSNumber *)reactTag
                  points:(NSArray *)points
                  radius:(double)radius
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    NSArray *result = [view computeClustersWithPoints:points radius:radius];
    resolve(result ?: @[]);
  }];
}

RCT_EXPORT_METHOD(prefetchMarkerIcons:(nonnull NSNumber *)reactTag urls:(NSArray<NSString *> *)urls)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view prefetchMarkerIcons:urls];
  }];
}

RCT_EXPORT_METHOD(clearMarkerIconCache:(nonnull NSNumber *)reactTag)
{
  [self withMap:reactTag block:^(RNCustomMapNativeView *view) {
    [view clearMarkerIconCache];
  }];
}

- (void)withMap:(NSNumber *)reactTag block:(void (^)(RNCustomMapNativeView *view))block
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIView *view = [self.bridge.uiManager viewForReactTag:reactTag];
    if ([view isKindOfClass:[RNCustomMapNativeView class]]) {
      block((RNCustomMapNativeView *)view);
    } else if ([view isKindOfClass:[RNCustomMapView class]]) {
      block([(RNCustomMapView *)view nativeMapView]);
    }
  });
}

@end
