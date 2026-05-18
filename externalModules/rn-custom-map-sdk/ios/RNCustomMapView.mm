#import "RNCustomMapView.h"
#import <GoogleMaps/GoogleMaps.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTConvert.h>
#import <React/RCTConversions.h>
#import <react/renderer/components/RNCustomMapSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNCustomMapSpec/EventEmitters.h>
#import <react/renderer/components/RNCustomMapSpec/Props.h>

using namespace facebook::react;

@interface RNCustomMapNativeView () <GMSMapViewDelegate>
@property (nonatomic, strong) GMSMapView *mapView;
@property (nonatomic, strong) NSMutableArray<GMSMarker *> *mapMarkers;
@property (nonatomic, strong) NSMutableDictionary<NSString *, GMSMarker *> *markersById;
@property (nonatomic, strong) NSMutableArray<GMSPolyline *> *mapPolylines;
@property (nonatomic, strong) NSMutableArray<GMSCircle *> *mapCircles;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *markerPayloads;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *markerTappables;
@property (nonatomic, copy) NSString *selectedMarkerId;
@property (nonatomic, assign) BOOL lastRegionChangeWasGesture;
@end

@implementation RNCustomMapNativeView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _mapMarkers = [NSMutableArray new];
    _markersById = [NSMutableDictionary new];
    _mapPolylines = [NSMutableArray new];
    _mapCircles = [NSMutableArray new];
    _markerPayloads = [NSMutableDictionary new];
    _markerTappables = [NSMutableDictionary new];

    GMSCameraPosition *camera = [GMSCameraPosition cameraWithLatitude:0 longitude:0 zoom:1];
    _mapView = [GMSMapView mapWithFrame:self.bounds camera:camera];
    _mapView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _mapView.delegate = self;
    [self addSubview:_mapView];

    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.onMapReady) {
        self.onMapReady(@{});
      }
    });
  }
  return self;
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  self.mapView.frame = self.bounds;
}

- (void)setProvider:(NSString *)provider
{
  // Google Maps is the iOS default. Apple Maps is accepted at the JS API layer
  // and can be wired to a MapKit-backed view as an optional provider later.
}

- (void)setCustomMapStyle:(NSString *)customMapStyle
{
  if (customMapStyle.length == 0) {
    self.mapView.mapStyle = nil;
    return;
  }

  NSError *error;
  GMSMapStyle *style = [GMSMapStyle styleWithJSONString:customMapStyle error:&error];
  if (style && !error) {
    self.mapView.mapStyle = style;
  }
}

- (void)setMinZoomLevel:(NSNumber *)minZoomLevel
{
  if (minZoomLevel) {
    [self.mapView setMinZoom:minZoomLevel.floatValue maxZoom:self.mapView.maxZoom];
  }
}

- (void)setMaxZoomLevel:(NSNumber *)maxZoomLevel
{
  if (maxZoomLevel) {
    [self.mapView setMinZoom:self.mapView.minZoom maxZoom:maxZoomLevel.floatValue];
  }
}

- (void)setMapTypeString:(NSString *)mapType
{
  if ([mapType isEqualToString:@"satellite"]) {
    self.mapView.mapType = kGMSTypeSatellite;
  } else if ([mapType isEqualToString:@"hybrid"]) {
    self.mapView.mapType = kGMSTypeHybrid;
  } else if ([mapType isEqualToString:@"terrain"]) {
    self.mapView.mapType = kGMSTypeTerrain;
  } else {
    self.mapView.mapType = kGMSTypeNormal;
  }
}

- (void)setShowsUserLocation:(BOOL)showsUserLocation
{
  self.mapView.myLocationEnabled = showsUserLocation;
}

- (void)setZoomEnabled:(BOOL)zoomEnabled
{
  self.mapView.settings.zoomGestures = zoomEnabled;
}

- (void)setScrollEnabled:(BOOL)scrollEnabled
{
  self.mapView.settings.scrollGestures = scrollEnabled;
}

- (void)setRotateEnabled:(BOOL)rotateEnabled
{
  self.mapView.settings.rotateGestures = rotateEnabled;
}

- (void)setPitchEnabled:(BOOL)pitchEnabled
{
  self.mapView.settings.tiltGestures = pitchEnabled;
}

- (void)setMarkers:(NSArray *)markers
{
  for (GMSMarker *marker in self.mapMarkers) {
    marker.map = nil;
  }
  [self.mapMarkers removeAllObjects];
  [self.markersById removeAllObjects];
  [self.markerPayloads removeAllObjects];
  [self.markerTappables removeAllObjects];
  self.selectedMarkerId = nil;

  for (NSDictionary *item in markers ?: @[]) {
    NSString *identifier = [RCTConvert NSString:item[@"id"]] ?: @"";
    CLLocationCoordinate2D coordinate = CLLocationCoordinate2DMake([item[@"latitude"] doubleValue], [item[@"longitude"] doubleValue]);
    GMSMarker *marker = [GMSMarker markerWithPosition:coordinate];
    marker.title = [RCTConvert NSString:item[@"title"]];
    marker.snippet = [RCTConvert NSString:item[@"description"]];
    marker.draggable = [RCTConvert BOOL:item[@"draggable"]];
    marker.flat = [RCTConvert BOOL:item[@"flat"]];
    marker.rotation = item[@"rotation"] ? [item[@"rotation"] doubleValue] : 0;
    marker.opacity = item[@"opacity"] ? [item[@"opacity"] floatValue] : 1;
    marker.groundAnchor = [self pointFromDictionary:item[@"anchor"] fallback:CGPointMake(0.5, 1)];
    marker.infoWindowAnchor = [self pointFromDictionary:item[@"calloutAnchor"] fallback:[self pointFromDictionary:item[@"calloutOffset"] fallback:CGPointMake(0.5, 0)]];
    marker.userData = identifier;
    marker.icon = [self markerImageForItem:item];
    marker.tracksViewChanges = item[@"tracksViewChanges"] ? [RCTConvert BOOL:item[@"tracksViewChanges"]] : YES;
    marker.map = self.mapView;

    self.markerPayloads[identifier] = @{
      @"id": identifier,
      @"coordinate": @{@"latitude": @(coordinate.latitude), @"longitude": @(coordinate.longitude)},
      @"title": marker.title ?: @"",
      @"description": marker.snippet ?: @""
    };
    self.markersById[identifier] = marker;
    self.markerTappables[identifier] = @([self boolFromDictionary:item key:@"tappable" fallback:YES]);
    [self.mapMarkers addObject:marker];
  }
}

- (void)setPolylines:(NSArray *)polylines
{
  for (GMSPolyline *polyline in self.mapPolylines) {
    polyline.map = nil;
  }
  [self.mapPolylines removeAllObjects];

  for (NSDictionary *item in polylines ?: @[]) {
    NSArray *coordinates = item[@"coordinates"];
    GMSMutablePath *path = [GMSMutablePath path];
    for (NSDictionary *coordinate in coordinates) {
      [path addLatitude:[coordinate[@"latitude"] doubleValue] longitude:[coordinate[@"longitude"] doubleValue]];
    }
    GMSPolyline *polyline = [GMSPolyline polylineWithPath:path];
    polyline.strokeColor = [self colorFromString:[RCTConvert NSString:item[@"strokeColor"]] fallback:UIColor.blueColor];
    polyline.strokeWidth = item[@"strokeWidth"] ? [item[@"strokeWidth"] doubleValue] : 1;
    polyline.geodesic = [RCTConvert BOOL:item[@"geodesic"]];
    polyline.zIndex = item[@"zIndex"] ? [item[@"zIndex"] intValue] : 0;
    polyline.tappable = [RCTConvert BOOL:item[@"tappable"]];
    polyline.userData = [RCTConvert NSString:item[@"id"]] ?: @"";
    polyline.map = self.mapView;
    [self.mapPolylines addObject:polyline];
  }
}

- (void)setCircles:(NSArray *)circles
{
  for (GMSCircle *circle in self.mapCircles) {
    circle.map = nil;
  }
  [self.mapCircles removeAllObjects];

  for (NSDictionary *item in circles ?: @[]) {
    NSDictionary *center = item[@"center"];
    CLLocationCoordinate2D coordinate = CLLocationCoordinate2DMake([center[@"latitude"] doubleValue], [center[@"longitude"] doubleValue]);
    GMSCircle *circle = [GMSCircle circleWithPosition:coordinate radius:[item[@"radius"] doubleValue]];
    circle.strokeColor = [self colorFromString:[RCTConvert NSString:item[@"strokeColor"]] fallback:UIColor.blueColor];
    circle.fillColor = [self colorFromString:[RCTConvert NSString:item[@"fillColor"]] fallback:UIColor.clearColor];
    circle.strokeWidth = item[@"strokeWidth"] ? [item[@"strokeWidth"] doubleValue] : 1;
    circle.zIndex = item[@"zIndex"] ? [item[@"zIndex"] intValue] : 0;
    circle.map = self.mapView;
    [self.mapCircles addObject:circle];
  }
}

- (NSArray *)currentMarkers
{
  return self.markerPayloads.allValues;
}

- (NSDictionary *)currentCamera
{
  GMSCameraPosition *camera = self.mapView.camera;
  return @{
    @"center": @{@"latitude": @(camera.target.latitude), @"longitude": @(camera.target.longitude)},
    @"pitch": @(camera.viewingAngle),
    @"heading": @(camera.bearing),
    @"zoom": @(camera.zoom)
  };
}

- (void)setCamera:(NSDictionary *)camera duration:(NSInteger)duration
{
  NSDictionary *center = camera[@"center"];
  if (!center) {
    return;
  }
  GMSCameraPosition *position = [GMSCameraPosition cameraWithLatitude:[center[@"latitude"] doubleValue]
                                                            longitude:[center[@"longitude"] doubleValue]
                                                                 zoom:camera[@"zoom"] ? [camera[@"zoom"] floatValue] : self.mapView.camera.zoom
                                                              bearing:camera[@"heading"] ? [camera[@"heading"] doubleValue] : self.mapView.camera.bearing
                                                         viewingAngle:camera[@"pitch"] ? [camera[@"pitch"] doubleValue] : self.mapView.camera.viewingAngle];
  if (duration > 0) {
    [self.mapView animateToCameraPosition:position];
  } else {
    self.mapView.camera = position;
  }
}

- (void)animateToRegion:(NSDictionary *)region duration:(NSInteger)duration
{
  CLLocationCoordinate2D center = CLLocationCoordinate2DMake([region[@"latitude"] doubleValue], [region[@"longitude"] doubleValue]);
  float zoom = [self zoomFromLongitudeDelta:[region[@"longitudeDelta"] doubleValue]];
  GMSCameraPosition *camera = [GMSCameraPosition cameraWithTarget:center zoom:zoom];
  if (duration > 0) {
    [self.mapView animateToCameraPosition:camera];
  } else {
    self.mapView.camera = camera;
  }
}

- (void)animateToCoordinate:(NSDictionary *)coordinate duration:(NSInteger)duration
{
  CLLocationCoordinate2D target = CLLocationCoordinate2DMake([coordinate[@"latitude"] doubleValue], [coordinate[@"longitude"] doubleValue]);
  GMSCameraPosition *camera = [GMSCameraPosition cameraWithTarget:target zoom:self.mapView.camera.zoom];
  if (duration > 0) {
    [self.mapView animateToCameraPosition:camera];
  } else {
    self.mapView.camera = camera;
  }
}

- (UIEdgeInsets)edgeInsetsFromOptions:(NSDictionary *)options
{
  NSDictionary *edgePadding = options[@"edgePadding"];
  if ([edgePadding isKindOfClass:[NSDictionary class]]) {
    return UIEdgeInsetsMake([edgePadding[@"top"] doubleValue], [edgePadding[@"left"] doubleValue], [edgePadding[@"bottom"] doubleValue], [edgePadding[@"right"] doubleValue]);
  }
  CGFloat padding = options[@"padding"] ? [options[@"padding"] doubleValue] : 50.0;
  return UIEdgeInsetsMake(padding, padding, padding, padding);
}

- (BOOL)animatedFromOptions:(NSDictionary *)options
{
  return options[@"animated"] ? [options[@"animated"] boolValue] : YES;
}

- (void)moveToBounds:(GMSCoordinateBounds *)bounds options:(NSDictionary *)options
{
  GMSCameraUpdate *update = [GMSCameraUpdate fitBounds:bounds withEdgeInsets:[self edgeInsetsFromOptions:options ?: @{}]];
  if ([self animatedFromOptions:options ?: @{}]) {
    [self.mapView animateWithCameraUpdate:update];
  } else {
    [self.mapView moveCamera:update];
  }
}

- (void)fitToCoordinates:(NSArray *)coordinates options:(NSDictionary *)options
{
  if (coordinates.count == 0) {
    return;
  }
  GMSCoordinateBounds *bounds;
  for (NSDictionary *item in coordinates) {
    CLLocationCoordinate2D coordinate = CLLocationCoordinate2DMake([item[@"latitude"] doubleValue], [item[@"longitude"] doubleValue]);
    bounds = bounds ? [bounds includingCoordinate:coordinate] : [[GMSCoordinateBounds alloc] initWithCoordinate:coordinate coordinate:coordinate];
  }
  [self moveToBounds:bounds options:options ?: @{}];
}

- (void)fitToElements:(NSDictionary *)options
{
  if (self.mapMarkers.count == 0) {
    return;
  }
  GMSCoordinateBounds *bounds;
  for (GMSMarker *marker in self.mapMarkers) {
    bounds = bounds ? [bounds includingCoordinate:marker.position] : [[GMSCoordinateBounds alloc] initWithCoordinate:marker.position coordinate:marker.position];
  }
  [self moveToBounds:bounds options:options ?: @{}];
}

- (void)fitToSuppliedMarkers:(NSArray *)markerIds options:(NSDictionary *)options
{
  GMSCoordinateBounds *bounds;
  for (NSString *markerId in markerIds ?: @[]) {
    GMSMarker *marker = self.markersById[markerId];
    if (marker) {
      bounds = bounds ? [bounds includingCoordinate:marker.position] : [[GMSCoordinateBounds alloc] initWithCoordinate:marker.position coordinate:marker.position];
    }
  }
  if (bounds) {
    [self moveToBounds:bounds options:options ?: @{}];
  }
}

- (void)showMarkerCallout:(NSString *)markerId
{
  GMSMarker *marker = self.markersById[markerId];
  if (!marker) {
    return;
  }
  self.mapView.selectedMarker = marker;
  self.selectedMarkerId = markerId;
  if (self.onMarkerSelect) {
    self.onMarkerSelect([self markerEvent:marker]);
  }
}

- (void)hideMarkerCallout:(NSString *)markerId
{
  GMSMarker *marker = self.markersById[markerId];
  if (!marker) {
    return;
  }
  if (self.mapView.selectedMarker == marker) {
    self.mapView.selectedMarker = nil;
  }
  if ([self.selectedMarkerId isEqualToString:markerId]) {
    self.selectedMarkerId = nil;
  }
  if (self.onMarkerDeselect) {
    self.onMarkerDeselect([self markerEvent:marker]);
  }
}

- (void)redrawMarker:(NSString *)markerId
{
  GMSMarker *marker = self.markersById[markerId];
  if (!marker) {
    return;
  }
  BOOL tracksViewChanges = marker.tracksViewChanges;
  marker.tracksViewChanges = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    marker.tracksViewChanges = tracksViewChanges;
  });
}

- (void)animateMarkerToCoordinate:(NSString *)markerId coordinate:(NSDictionary *)coordinate options:(NSDictionary *)options
{
  GMSMarker *marker = self.markersById[markerId];
  if (!marker || !coordinate) {
    return;
  }
  NSInteger duration = options[@"duration"] ? [options[@"duration"] integerValue] : 500;
  CLLocationCoordinate2D target = CLLocationCoordinate2DMake([coordinate[@"latitude"] doubleValue], [coordinate[@"longitude"] doubleValue]);
  [CATransaction begin];
  [CATransaction setAnimationDuration:MAX(duration, 0) / 1000.0];
  NSString *easing = options[@"easing"] ?: options[@"interpolator"];
  if ([easing isEqualToString:@"linear"]) {
    [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear]];
  } else if ([easing isEqualToString:@"easeIn"]) {
    [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseIn]];
  } else if ([easing isEqualToString:@"easeOut"]) {
    [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut]];
  } else {
    [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut]];
  }
  marker.position = target;
  [CATransaction commit];
  [self updateMarkerPayload:markerId marker:marker];
}

- (void)setMarkerView:(UIView *)markerView markerId:(NSString *)markerId
{
  GMSMarker *marker = self.markersById[markerId];
  if (!marker || !markerView) {
    return;
  }
  marker.iconView = markerView;
  marker.tracksViewChanges = YES;
}

- (void)mapView:(GMSMapView *)mapView didTapAtCoordinate:(CLLocationCoordinate2D)coordinate
{
  if (self.onPress) {
    self.onPress(@{@"coordinate": @{@"latitude": @(coordinate.latitude), @"longitude": @(coordinate.longitude)}});
  }
}

- (void)mapView:(GMSMapView *)mapView didLongPressAtCoordinate:(CLLocationCoordinate2D)coordinate
{
  if (self.onLongPress) {
    self.onLongPress(@{@"coordinate": @{@"latitude": @(coordinate.latitude), @"longitude": @(coordinate.longitude)}});
  }
}

- (BOOL)mapView:(GMSMapView *)mapView didTapMarker:(GMSMarker *)marker
{
  NSString *identifier = [RCTConvert NSString:marker.userData] ?: @"";
  if (self.markerTappables[identifier] && !self.markerTappables[identifier].boolValue) {
    return YES;
  }
  if (self.selectedMarkerId && ![self.selectedMarkerId isEqualToString:identifier]) {
    GMSMarker *selectedMarker = self.markersById[self.selectedMarkerId];
    if (selectedMarker && self.onMarkerDeselect) {
      self.onMarkerDeselect([self markerEvent:selectedMarker]);
    }
  }
  self.selectedMarkerId = identifier;
  if (self.onMarkerPress) {
    self.onMarkerPress([self markerEvent:marker]);
  }
  if (self.onMarkerSelect) {
    self.onMarkerSelect([self markerEvent:marker]);
  }
  return NO;
}

- (void)mapView:(GMSMapView *)mapView didTapInfoWindowOfMarker:(GMSMarker *)marker
{
  if (self.onCalloutPress) {
    self.onCalloutPress([self markerEvent:marker]);
  }
}

- (void)mapView:(GMSMapView *)mapView didBeginDraggingMarker:(GMSMarker *)marker
{
  if (self.onMarkerDragStart) {
    self.onMarkerDragStart([self markerEvent:marker]);
  }
}

- (void)mapView:(GMSMapView *)mapView didDragMarker:(GMSMarker *)marker
{
  NSString *identifier = [RCTConvert NSString:marker.userData] ?: @"";
  [self updateMarkerPayload:identifier marker:marker];
  if (self.onMarkerDrag) {
    self.onMarkerDrag([self markerEvent:marker]);
  }
}

- (void)mapView:(GMSMapView *)mapView didEndDraggingMarker:(GMSMarker *)marker
{
  NSString *identifier = [RCTConvert NSString:marker.userData] ?: @"";
  [self updateMarkerPayload:identifier marker:marker];
  if (self.onMarkerDragEnd) {
    self.onMarkerDragEnd([self markerEvent:marker]);
  }
}

- (void)mapView:(GMSMapView *)mapView willMove:(BOOL)gesture
{
  self.lastRegionChangeWasGesture = gesture;
}

- (void)mapView:(GMSMapView *)mapView didChangeCameraPosition:(GMSCameraPosition *)position
{
  if (self.onRegionChange) {
    self.onRegionChange(@{@"region": [self regionPayload], @"details": @{@"isGesture": @(self.lastRegionChangeWasGesture)}});
  }
}

- (void)mapView:(GMSMapView *)mapView idleAtCameraPosition:(GMSCameraPosition *)position
{
  if (self.onRegionChangeComplete) {
    self.onRegionChangeComplete(@{@"region": [self regionPayload], @"details": @{@"isGesture": @(self.lastRegionChangeWasGesture)}});
  }
}

- (void)mapView:(GMSMapView *)mapView didTapOverlay:(GMSOverlay *)overlay
{
  if (self.onPolylinePress && [overlay isKindOfClass:[GMSPolyline class]]) {
    self.onPolylinePress(@{@"id": [RCTConvert NSString:overlay.userData] ?: @""});
  }
}

- (NSDictionary *)markerEvent:(GMSMarker *)marker
{
  NSString *identifier = [RCTConvert NSString:marker.userData] ?: @"";
  return @{@"id": identifier, @"coordinate": @{@"latitude": @(marker.position.latitude), @"longitude": @(marker.position.longitude)}};
}

- (void)updateMarkerPayload:(NSString *)identifier marker:(GMSMarker *)marker
{
  if (identifier.length == 0 || !marker) {
    return;
  }
  self.markerPayloads[identifier] = @{
    @"id": identifier,
    @"coordinate": @{@"latitude": @(marker.position.latitude), @"longitude": @(marker.position.longitude)},
    @"title": marker.title ?: @"",
    @"description": marker.snippet ?: @""
  };
}

- (NSDictionary *)regionPayload
{
  GMSVisibleRegion visible = self.mapView.projection.visibleRegion;
  double latitudeDelta = fabs(visible.farLeft.latitude - visible.nearLeft.latitude);
  double longitudeDelta = fabs(visible.farRight.longitude - visible.farLeft.longitude);
  return @{
    @"latitude": @(self.mapView.camera.target.latitude),
    @"longitude": @(self.mapView.camera.target.longitude),
    @"latitudeDelta": @(latitudeDelta),
    @"longitudeDelta": @(longitudeDelta)
  };
}

- (UIColor *)colorFromString:(NSString *)color fallback:(UIColor *)fallback
{
  if (!color) {
    return fallback;
  }
  color = [color stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if ([color hasPrefix:@"rgba("]) {
    NSString *body = [[color stringByReplacingOccurrencesOfString:@"rgba(" withString:@""] stringByReplacingOccurrencesOfString:@")" withString:@""];
    NSArray<NSString *> *parts = [body componentsSeparatedByString:@","];
    if (parts.count == 4) {
      return [UIColor colorWithRed:[parts[0] doubleValue] / 255.0
                             green:[parts[1] doubleValue] / 255.0
                              blue:[parts[2] doubleValue] / 255.0
                             alpha:[parts[3] doubleValue] > 1 ? [parts[3] doubleValue] / 255.0 : [parts[3] doubleValue]];
    }
  }
  if ([color hasPrefix:@"rgb("]) {
    NSString *body = [[color stringByReplacingOccurrencesOfString:@"rgb(" withString:@""] stringByReplacingOccurrencesOfString:@")" withString:@""];
    NSArray<NSString *> *parts = [body componentsSeparatedByString:@","];
    if (parts.count == 3) {
      return [UIColor colorWithRed:[parts[0] doubleValue] / 255.0
                             green:[parts[1] doubleValue] / 255.0
                              blue:[parts[2] doubleValue] / 255.0
                             alpha:1];
    }
  }
  if (![color hasPrefix:@"#"]) {
    return fallback;
  }
  unsigned int value = 0;
  [[NSScanner scannerWithString:[color substringFromIndex:1]] scanHexInt:&value];
  if (color.length == 7) {
    return [UIColor colorWithRed:((value >> 16) & 0xff) / 255.0
                           green:((value >> 8) & 0xff) / 255.0
                            blue:(value & 0xff) / 255.0
                           alpha:1];
  }
  if (color.length == 9) {
    return [UIColor colorWithRed:((value >> 24) & 0xff) / 255.0
                           green:((value >> 16) & 0xff) / 255.0
                            blue:((value >> 8) & 0xff) / 255.0
                           alpha:(value & 0xff) / 255.0];
  }
  return fallback;
}

- (BOOL)boolFromDictionary:(NSDictionary *)dictionary key:(NSString *)key fallback:(BOOL)fallback
{
  id value = dictionary[key];
  return value == nil || value == (id)kCFNull ? fallback : [RCTConvert BOOL:value];
}

- (CGPoint)pointFromDictionary:(NSDictionary *)dictionary fallback:(CGPoint)fallback
{
  if (![dictionary isKindOfClass:NSDictionary.class]) {
    return fallback;
  }
  return CGPointMake(dictionary[@"x"] ? [dictionary[@"x"] doubleValue] : fallback.x,
                     dictionary[@"y"] ? [dictionary[@"y"] doubleValue] : fallback.y);
}

- (UIImage *)markerImageForItem:(NSDictionary *)item
{
  NSString *source = [RCTConvert NSString:item[@"icon"]] ?: [RCTConvert NSString:item[@"image"]];
  if (source.length > 0) {
    UIImage *image = [UIImage imageNamed:source];
    if (!image) {
      NSURL *url = [NSURL URLWithString:source];
      if (url.isFileURL) {
        image = [UIImage imageWithContentsOfFile:url.path];
      }
    }
    if (image) {
      return image;
    }
  }
  return [GMSMarker markerImageWithColor:[self colorFromString:[RCTConvert NSString:item[@"pinColor"]] fallback:UIColor.redColor]];
}

- (float)zoomFromLongitudeDelta:(double)longitudeDelta
{
  if (longitudeDelta <= 0) {
    return self.mapView.camera.zoom;
  }
  return MAX(0, MIN(21, log2(360.0 / longitudeDelta)));
}

#pragma mark - Clustering acceleration

/**
 * Pixel-space grid clustering using GMSMapView's projection. Returns
 * id groupings only — JS enriches with marker.data so renderCluster()
 * keeps full access to anything the marker carries (images, names, etc).
 *
 * O(n). Always called on the main queue (the projection is main-thread-only).
 */
- (NSArray<NSDictionary *> *)computeClustersWithPoints:(NSArray<NSDictionary *> *)points
                                                radius:(double)radius
{
  if (!self.mapView || points.count == 0) {
    return @[];
  }
  double r = radius > 0 ? radius : 60.0;
  GMSProjection *projection = self.mapView.projection;

  NSMutableDictionary<NSString *, NSMutableArray<NSString *> *> *grid = [NSMutableDictionary dictionary];
  NSMutableDictionary<NSString *, NSMutableArray<NSNumber *> *> *latSums = [NSMutableDictionary dictionary];
  NSMutableDictionary<NSString *, NSMutableArray<NSNumber *> *> *lngSums = [NSMutableDictionary dictionary];

  for (NSDictionary *p in points) {
    NSString *pid = p[@"id"];
    if (![pid isKindOfClass:[NSString class]]) continue;
    double lat = [p[@"latitude"] doubleValue];
    double lng = [p[@"longitude"] doubleValue];
    CLLocationCoordinate2D coord = CLLocationCoordinate2DMake(lat, lng);
    CGPoint screen = [projection pointForCoordinate:coord];

    NSInteger cx = (NSInteger)floor(screen.x / r);
    NSInteger cy = (NSInteger)floor(screen.y / r);
    NSString *key = [NSString stringWithFormat:@"%ld:%ld", (long)cx, (long)cy];

    NSMutableArray<NSString *> *bucket = grid[key];
    if (!bucket) {
      bucket = [NSMutableArray array];
      grid[key] = bucket;
      latSums[key] = [NSMutableArray array];
      lngSums[key] = [NSMutableArray array];
    }
    [bucket addObject:pid];
    [latSums[key] addObject:@(lat)];
    [lngSums[key] addObject:@(lng)];
  }

  NSMutableArray<NSDictionary *> *out = [NSMutableArray arrayWithCapacity:grid.count];
  for (NSString *key in grid) {
    NSMutableArray<NSString *> *ids = grid[key];
    double latSum = 0, lngSum = 0;
    for (NSNumber *n in latSums[key]) latSum += n.doubleValue;
    for (NSNumber *n in lngSums[key]) lngSum += n.doubleValue;
    NSUInteger count = ids.count;
    [out addObject:@{
      @"bucketId": [@"grid:" stringByAppendingString:key],
      @"markerIds": [ids copy],
      @"latitude": @(latSum / (double)count),
      @"longitude": @(lngSum / (double)count),
    }];
  }
  return out;
}

@end

static NSString *RNCustomMapNSString(const std::string &value)
{
  return [NSString stringWithUTF8String:value.c_str()];
}

static double RNCustomMapDouble(NSDictionary *dictionary, NSString *key)
{
  return [dictionary[key] doubleValue];
}

static std::string RNCustomMapStdString(NSDictionary *dictionary, NSString *key)
{
  NSString *value = [RCTConvert NSString:dictionary[key]] ?: @"";
  return std::string(value.UTF8String);
}

static NSDictionary *RNCustomMapRegionDictionary(const RNCustomMapViewInitialRegionStruct &region)
{
  return @{
    @"latitude": @(region.latitude),
    @"longitude": @(region.longitude),
    @"latitudeDelta": @(region.latitudeDelta),
    @"longitudeDelta": @(region.longitudeDelta)
  };
}

static NSDictionary *RNCustomMapRegionDictionary(const RNCustomMapViewRegionStruct &region)
{
  return @{
    @"latitude": @(region.latitude),
    @"longitude": @(region.longitude),
    @"latitudeDelta": @(region.latitudeDelta),
    @"longitudeDelta": @(region.longitudeDelta)
  };
}

static NSDictionary *RNCustomMapCameraDictionary(const RNCustomMapViewCameraStruct &camera)
{
  return @{
    @"center": @{
      @"latitude": @(camera.center.latitude),
      @"longitude": @(camera.center.longitude)
    },
    @"pitch": @(camera.pitch),
    @"heading": @(camera.heading),
    @"zoom": @(camera.zoom)
  };
}

static NSArray *RNCustomMapMarkersArray(const std::vector<RNCustomMapViewMarkersStruct> &markers)
{
  NSMutableArray *items = [NSMutableArray arrayWithCapacity:markers.size()];
  for (const auto &marker : markers) {
    NSMutableDictionary *item = [@{
      @"id": RNCustomMapNSString(marker.id),
      @"latitude": @(marker.latitude),
      @"longitude": @(marker.longitude),
      @"title": RNCustomMapNSString(marker.title),
      @"description": RNCustomMapNSString(marker.description),
      @"pinColor": RNCustomMapNSString(marker.pinColor),
      @"image": RNCustomMapNSString(marker.image),
      @"icon": RNCustomMapNSString(marker.icon),
      @"draggable": @(marker.draggable),
      @"flat": @(marker.flat),
      @"rotation": @(marker.rotation),
      @"opacity": @(marker.opacity),
      @"tappable": @(marker.tappable),
      @"tracksViewChanges": @(marker.tracksViewChanges),
      @"calloutTooltip": @(marker.calloutTooltip)
    } mutableCopy];
    item[@"anchor"] = @{@"x": @(marker.anchor.x), @"y": @(marker.anchor.y)};
    item[@"centerOffset"] = @{@"x": @(marker.centerOffset.x), @"y": @(marker.centerOffset.y)};
    item[@"calloutOffset"] = @{@"x": @(marker.calloutOffset.x), @"y": @(marker.calloutOffset.y)};
    item[@"calloutAnchor"] = @{@"x": @(marker.calloutAnchor.x), @"y": @(marker.calloutAnchor.y)};
    [items addObject:item];
  }
  return items;
}

static NSArray *RNCustomMapPolylinesArray(const std::vector<RNCustomMapViewPolylinesStruct> &polylines)
{
  NSMutableArray *items = [NSMutableArray arrayWithCapacity:polylines.size()];
  for (const auto &polyline : polylines) {
    NSMutableArray *coordinates = [NSMutableArray arrayWithCapacity:polyline.coordinates.size()];
    for (const auto &coordinate : polyline.coordinates) {
      [coordinates addObject:@{
        @"latitude": @(coordinate.latitude),
        @"longitude": @(coordinate.longitude)
      }];
    }
    NSMutableArray *dashPattern = [NSMutableArray arrayWithCapacity:polyline.lineDashPattern.size()];
    for (const auto &dash : polyline.lineDashPattern) {
      [dashPattern addObject:@(dash)];
    }
    [items addObject:@{
      @"id": RNCustomMapNSString(polyline.id),
      @"coordinates": coordinates,
      @"strokeColor": RNCustomMapNSString(polyline.strokeColor),
      @"strokeWidth": @(polyline.strokeWidth),
      @"lineDashPattern": dashPattern,
      @"geodesic": @(polyline.geodesic),
      @"zIndex": @(polyline.zIndex),
      @"tappable": @(polyline.tappable)
    }];
  }
  return items;
}

static NSArray *RNCustomMapCirclesArray(const std::vector<RNCustomMapViewCirclesStruct> &circles)
{
  NSMutableArray *items = [NSMutableArray arrayWithCapacity:circles.size()];
  for (const auto &circle : circles) {
    [items addObject:@{
      @"id": RNCustomMapNSString(circle.id),
      @"center": @{
        @"latitude": @(circle.center.latitude),
        @"longitude": @(circle.center.longitude)
      },
      @"radius": @(circle.radius),
      @"strokeColor": RNCustomMapNSString(circle.strokeColor),
      @"strokeWidth": @(circle.strokeWidth),
      @"fillColor": RNCustomMapNSString(circle.fillColor),
      @"zIndex": @(circle.zIndex)
    }];
  }
  return items;
}

@implementation RNCustomMapView {
  RNCustomMapNativeView *_nativeMapView;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<RNCustomMapViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _nativeMapView = [RNCustomMapNativeView new];
    self.contentView = _nativeMapView;

    __weak RNCustomMapView *weakSelf = self;
    _nativeMapView.onPress = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onPress({{RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onLongPress = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onLongPress({{RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onRegionChange = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *region = body[@"region"] ?: @{};
      NSDictionary *details = body[@"details"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onRegionChange({
          {RNCustomMapDouble(region, @"latitude"), RNCustomMapDouble(region, @"longitude"), RNCustomMapDouble(region, @"latitudeDelta"), RNCustomMapDouble(region, @"longitudeDelta")},
          {static_cast<bool>([details[@"isGesture"] boolValue])}
        });
    };
    _nativeMapView.onRegionChangeComplete = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *region = body[@"region"] ?: @{};
      NSDictionary *details = body[@"details"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onRegionChangeComplete({
          {RNCustomMapDouble(region, @"latitude"), RNCustomMapDouble(region, @"longitude"), RNCustomMapDouble(region, @"latitudeDelta"), RNCustomMapDouble(region, @"longitudeDelta")},
          {static_cast<bool>([details[@"isGesture"] boolValue])}
        });
    };
    _nativeMapView.onMapReady = ^(__unused NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)->onMapReady({});
    };
    _nativeMapView.onUserLocationChange = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onUserLocationChange({{RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onMarkerPress = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onMarkerPress({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onMarkerSelect = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onMarkerSelect({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onMarkerDeselect = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onMarkerDeselect({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onMarkerDragStart = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onMarkerDragStart({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onMarkerDrag = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onMarkerDrag({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onMarkerDragEnd = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onMarkerDragEnd({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onCalloutPress = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      NSDictionary *coordinate = body[@"coordinate"] ?: @{};
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onCalloutPress({RNCustomMapStdString(body, @"id"), {RNCustomMapDouble(coordinate, @"latitude"), RNCustomMapDouble(coordinate, @"longitude")}});
    };
    _nativeMapView.onPolylinePress = ^(NSDictionary *body) {
      RNCustomMapView *strongSelf = weakSelf;
      if (!strongSelf || !strongSelf->_eventEmitter) {
        return;
      }
      std::static_pointer_cast<const RNCustomMapViewEventEmitter>(strongSelf->_eventEmitter)
        ->onPolylinePress({RNCustomMapStdString(body, @"id")});
    };
  }
  return self;
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &mapProps = *std::static_pointer_cast<const RNCustomMapViewProps>(props);
  static const auto defaultProps = std::make_shared<const RNCustomMapViewProps>();
  const auto &oldMapProps = oldProps
    ? *std::static_pointer_cast<const RNCustomMapViewProps>(oldProps)
    : *defaultProps;

  if (mapProps.provider != oldMapProps.provider) {
    [_nativeMapView setProvider:RNCustomMapNSString(toString(mapProps.provider))];
  }
  if (mapProps.mapType != oldMapProps.mapType) {
    [_nativeMapView setMapTypeString:RNCustomMapNSString(toString(mapProps.mapType))];
  }
  if (mapProps.customMapStyle != oldMapProps.customMapStyle) {
    [_nativeMapView setCustomMapStyle:RNCustomMapNSString(mapProps.customMapStyle)];
  }
  if (mapProps.showsUserLocation != oldMapProps.showsUserLocation) {
    [_nativeMapView setShowsUserLocation:mapProps.showsUserLocation];
  }
  if (mapProps.zoomEnabled != oldMapProps.zoomEnabled) {
    [_nativeMapView setZoomEnabled:mapProps.zoomEnabled];
  }
  if (mapProps.scrollEnabled != oldMapProps.scrollEnabled) {
    [_nativeMapView setScrollEnabled:mapProps.scrollEnabled];
  }
  if (mapProps.rotateEnabled != oldMapProps.rotateEnabled) {
    [_nativeMapView setRotateEnabled:mapProps.rotateEnabled];
  }
  if (mapProps.pitchEnabled != oldMapProps.pitchEnabled) {
    [_nativeMapView setPitchEnabled:mapProps.pitchEnabled];
  }
  if (mapProps.minZoomLevel != oldMapProps.minZoomLevel) {
    [_nativeMapView setMinZoomLevel:@(mapProps.minZoomLevel)];
  }
  if (mapProps.maxZoomLevel != oldMapProps.maxZoomLevel && mapProps.maxZoomLevel > 0) {
    [_nativeMapView setMaxZoomLevel:@(mapProps.maxZoomLevel)];
  }
  if (mapProps.initialRegion.latitudeDelta != 0 && mapProps.initialRegion.longitudeDelta != 0 && !_nativeMapView.initialRegionApplied) {
    _nativeMapView.initialRegionApplied = YES;
    [_nativeMapView animateToRegion:RNCustomMapRegionDictionary(mapProps.initialRegion) duration:0];
  }
  if (mapProps.region.latitudeDelta != 0 && mapProps.region.longitudeDelta != 0) {
    [_nativeMapView animateToRegion:RNCustomMapRegionDictionary(mapProps.region) duration:0];
  }
  if (mapProps.camera.zoom > 0) {
    [_nativeMapView setCamera:RNCustomMapCameraDictionary(mapProps.camera) duration:0];
  }
  [_nativeMapView setMarkers:RNCustomMapMarkersArray(mapProps.markers)];
  [_nativeMapView setPolylines:RNCustomMapPolylinesArray(mapProps.polylines)];
  [_nativeMapView setCircles:RNCustomMapCirclesArray(mapProps.circles)];

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [_nativeMapView setMarkers:@[]];
  [_nativeMapView setPolylines:@[]];
  [_nativeMapView setCircles:@[]];
  _nativeMapView.initialRegionApplied = NO;
}

- (RNCustomMapNativeView *)nativeMapView
{
  return _nativeMapView;
}

@end
