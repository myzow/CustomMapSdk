#import "RNCustomMapView.h"
#import <GoogleMaps/GoogleMaps.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
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
/**
 * Process-wide icon cache. Keys are either:
 *   - "src:<sourceString>"      (built-in `image` / `icon` props)
 *   - "pin:<colorHex>"           (pinColor default markers)
 *   - "view:<markerId>:<hash>"   (snapshots of React-rendered marker views)
 * Holding UIImages here is cheap (Core Animation backs them with shared
 * bitmap storage) and prevents the "default pin flash" that happens when
 * clusters re-render and have to re-resolve their icon from scratch.
 */
@property (nonatomic, strong) NSCache<NSString *, UIImage *> *markerIconCache;
/**
 * For each currently-mounted marker, remembers which cache key its icon was
 * built from. We compare on every diff pass and only call `marker.icon = ...`
 * when the key actually changed — that keeps the icon stable across
 * re-clustering, which is what eliminates the "default pin flash" reported
 * in Issue 2.
 */
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *markerIconKeys;
/**
 * Marker source payload remembered across diff passes, used to decide
 * whether title / coordinates / icon source actually changed. Avoids
 * re-applying identical props (= no GMS-side relayout, no flicker).
 */
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *markerLastItems;
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
    _markerIconCache = [[NSCache alloc] init];
    _markerIconCache.countLimit = 256;
    _markerIconKeys = [NSMutableDictionary new];
    _markerLastItems = [NSMutableDictionary new];

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
  // ----------------------------------------------------------------------
  // Incremental diff (Issue 2 fix):
  //   Old behaviour was nuke-and-rebuild on every prop update, which made
  //   every cluster recompute briefly draw the default Google pin before
  //   the icon image reattached. We now diff by id and:
  //     - keep markers whose id is unchanged
  //     - only mutate the smallest possible surface (position, icon-on-
  //       source-change, title, etc.)
  //     - never re-add a marker that is already on the map
  // ----------------------------------------------------------------------
  NSArray *incoming = markers ?: @[];
  NSMutableSet<NSString *> *incomingIds = [NSMutableSet setWithCapacity:incoming.count];
  for (NSDictionary *item in incoming) {
    NSString *identifier = [RCTConvert NSString:item[@"id"]];
    if (identifier.length > 0) {
      [incomingIds addObject:identifier];
    }
  }

  // 1) Remove markers that are no longer in the prop. CRITICAL: do NOT
  //    touch marker.iconView here — we never use iconView anymore (Issue 1).
  NSArray<NSString *> *existingIds = [self.markersById.allKeys copy];
  for (NSString *existingId in existingIds) {
    if (![incomingIds containsObject:existingId]) {
      GMSMarker *gone = self.markersById[existingId];
      gone.map = nil;
      [self.markersById removeObjectForKey:existingId];
      [self.markerPayloads removeObjectForKey:existingId];
      [self.markerTappables removeObjectForKey:existingId];
      [self.markerIconKeys removeObjectForKey:existingId];
      [self.markerLastItems removeObjectForKey:existingId];
      if (gone) [self.mapMarkers removeObject:gone];
      if ([self.selectedMarkerId isEqualToString:existingId]) {
        self.selectedMarkerId = nil;
      }
    }
  }

  // 2) Update / create.
  for (NSDictionary *item in incoming) {
    NSString *identifier = [RCTConvert NSString:item[@"id"]] ?: @"";
    if (identifier.length == 0) continue;
    CLLocationCoordinate2D coordinate = CLLocationCoordinate2DMake(
        [item[@"latitude"] doubleValue], [item[@"longitude"] doubleValue]);
    GMSMarker *marker = self.markersById[identifier];
    BOOL isNew = (marker == nil);
    if (isNew) {
      marker = [GMSMarker markerWithPosition:coordinate];
      marker.userData = identifier;
    } else {
      // Only move the marker if the coordinate actually changed — saves a
      // re-layout pass and keeps a singleton marker visually frozen during
      // pan/zoom (Issue 2: "Single markers should NOT re-render at all").
      if (marker.position.latitude != coordinate.latitude ||
          marker.position.longitude != coordinate.longitude) {
        marker.position = coordinate;
      }
    }

    NSString *newTitle = [RCTConvert NSString:item[@"title"]];
    if (![marker.title isEqualToString:newTitle ?: @""]) marker.title = newTitle;
    NSString *newSnippet = [RCTConvert NSString:item[@"description"]];
    if (![marker.snippet isEqualToString:newSnippet ?: @""]) marker.snippet = newSnippet;
    marker.draggable = [RCTConvert BOOL:item[@"draggable"]];
    marker.flat = [RCTConvert BOOL:item[@"flat"]];
    marker.rotation = item[@"rotation"] ? [item[@"rotation"] doubleValue] : 0;
    marker.opacity = item[@"opacity"] ? [item[@"opacity"] floatValue] : 1;
    marker.groundAnchor = [self pointFromDictionary:item[@"anchor"] fallback:CGPointMake(0.5, 1)];
    marker.infoWindowAnchor = [self pointFromDictionary:item[@"calloutAnchor"]
                                                fallback:[self pointFromDictionary:item[@"calloutOffset"]
                                                                          fallback:CGPointMake(0.5, 0)]];
    BOOL incomingTracks = item[@"tracksViewChanges"]
        ? [RCTConvert BOOL:item[@"tracksViewChanges"]] : NO;
    if (marker.tracksViewChanges != incomingTracks) {
      marker.tracksViewChanges = incomingTracks;
    }

    // Icon: only re-apply when the source key actually changed. This is the
    // hot path that used to cause the "default pin flash" — we now hit the
    // NSCache, so re-clustering reuses the same UIImage instance and the
    // marker never visually drops back to the GMS default.
    NSString *iconKey = [self iconCacheKeyForItem:item];
    NSString *previousKey = self.markerIconKeys[identifier];
    if (isNew || ![previousKey isEqualToString:iconKey]) {
      UIImage *image = [self cachedIconForItem:item key:iconKey];
      if (image) marker.icon = image;
      if (iconKey) self.markerIconKeys[identifier] = iconKey;
    }

    // Kick off (or coalesce) async HTTP fetches for remote icon sources.
    // Cache-hits return synchronously inside fetchRemoteIconForMarkerId:
    // — this is what makes the second single↔cluster transition instant.
    if (isNew) {
      NSString *src = [RCTConvert NSString:item[@"icon"]] ?: [RCTConvert NSString:item[@"image"]];
      if (src.length > 0) {
        NSURL *u = [NSURL URLWithString:src];
        if (u && ([u.scheme isEqualToString:@"http"] || [u.scheme isEqualToString:@"https"])) {
          [self fetchRemoteIconForMarkerId:identifier source:src];
        }
      }
    }

    if (isNew) {
      marker.map = self.mapView;
      [self.mapMarkers addObject:marker];
      self.markersById[identifier] = marker;
    }
    self.markerPayloads[identifier] = @{
      @"id": identifier,
      @"coordinate": @{@"latitude": @(coordinate.latitude), @"longitude": @(coordinate.longitude)},
      @"title": marker.title ?: @"",
      @"description": marker.snippet ?: @""
    };
    self.markerTappables[identifier] = @([self boolFromDictionary:item key:@"tappable" fallback:YES]);
    self.markerLastItems[identifier] = item;
  }
}

#pragma mark - Marker icon cache

/**
 * Stable cache key for a marker's icon spec. Markers with the same icon
 * source share the same UIImage instance across the entire map, which is
 * what makes Issue 2 disappear: a cluster bubble re-spawned at the same zoom
 * level pulls its icon from cache instantly instead of falling back to the
 * default pin while a view snapshot is built.
 */
- (NSString *)iconCacheKeyForItem:(NSDictionary *)item
{
  NSString *source = [RCTConvert NSString:item[@"icon"]] ?: [RCTConvert NSString:item[@"image"]];
  if (source.length > 0) return [@"src:" stringByAppendingString:source];
  NSString *pin = [RCTConvert NSString:item[@"pinColor"]];
  if (pin.length > 0) return [@"pin:" stringByAppendingString:pin];
  // Cluster synthetic markers carry no icon/pinColor; they get a transparent
  // placeholder. Keep their cache slot separate from regular default-pin
  // markers so the two never share a UIImage by accident.
  NSString *identifier = [RCTConvert NSString:item[@"id"]];
  if ([identifier hasPrefix:@"cluster:"]) return @"cluster:placeholder";
  return @"pin:default";
}

- (UIImage *)cachedIconForItem:(NSDictionary *)item key:(NSString *)key
{
  if (key.length == 0) return nil;
  UIImage *cached = [self.markerIconCache objectForKey:key];
  if (cached) return cached;
  UIImage *image = [self markerImageForItem:item];
  if (image) [self.markerIconCache setObject:image forKey:key];
  return image;
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
  if (!marker || !markerView || markerId.length == 0) {
    return;
  }
  CGSize size = markerView.bounds.size;
  if (size.width <= 0 || size.height <= 0) {
    // The React view may not have been measured yet; bail and rely on the
    // follow-up onLayout-triggered call from the JS side.
    return;
  }

  // ----------------------------------------------------------------------
  // Issue 1 fix: do NOT reparent the React-owned UIView onto the marker.
  //
  // Assigning marker.iconView = markerView causes GMSMapView to physically
  // move the view into its own internal hierarchy. The React reconciler
  // later tries to unmount that same view from its *original* parent and
  // crashes with "Attempt to unmount a view which is mounted inside
  // different view".
  //
  // Instead, take a UIImage snapshot of the React view and assign it as
  // marker.icon — the view stays exactly where React put it, and the marker
  // renders the snapshot. Snapshots are cached under
  // "view:<markerId>:<size+contentHash>" so repeated re-cluster passes
  // hit the cache and show the icon immediately (Issue 2: "no flash").
  // ----------------------------------------------------------------------
  NSString *contentKey = [self snapshotKeyForView:markerView markerId:markerId];
  UIImage *image = [self.markerIconCache objectForKey:contentKey];
  if (!image) {
    image = [self renderViewToImage:markerView];
    if (image) [self.markerIconCache setObject:image forKey:contentKey];
  }
  if (!image) {
    return;
  }
  marker.icon = image;
  marker.groundAnchor = CGPointMake(0.5, 0.5);
  marker.tracksViewChanges = NO;
  self.markerIconKeys[markerId] = contentKey;
}

/**
 * Render a UIView's current visual state into a UIImage at the device's
 * native scale. Uses drawViewHierarchyInRect because some children may host
 * UIKit controls / async-loaded images that don't render via -[CALayer
 * renderInContext:].
 */
- (UIImage *)renderViewToImage:(UIView *)view
{
  CGSize size = view.bounds.size;
  if (size.width <= 0 || size.height <= 0) return nil;
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:format];
  return [renderer imageWithActions:^(__unused UIGraphicsImageRendererContext *ctx) {
    [view drawViewHierarchyInRect:view.bounds afterScreenUpdates:NO];
  }];
}

/**
 * Build a snapshot cache key from the view's geometry + subview signature.
 * The key intentionally does NOT include the markerId: a cluster bubble's
 * visual is determined entirely by its contents, so two different cluster
 * ids that happen to render the same bubble (e.g. "3 stacked avatars + 7")
 * share a single UIImage. That sharing is what kills the "image disappears
 * when single↔cluster" repaint on zoom.
 */
- (NSString *)snapshotKeyForView:(UIView *)view markerId:(__unused NSString *)markerId
{
  CGSize size = view.bounds.size;
  NSUInteger sig = view.subviews.count;
  for (UIView *child in view.subviews) {
    sig = sig * 31 + (NSUInteger)CGRectGetWidth(child.bounds);
    sig = sig * 31 + (NSUInteger)CGRectGetHeight(child.bounds);
    sig = sig * 31 + (NSUInteger)[child class];
  }
  return [NSString stringWithFormat:@"view:%.0fx%.0f:%lu",
                                    size.width, size.height, (unsigned long)sig];
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
    // 1) Already cached from a previous fetch (any marker, any time) ?
    UIImage *cached = [self.markerIconCache objectForKey:[@"src:" stringByAppendingString:source]];
    if (cached) return cached;
    // 2) Bundled image / file URL?
    UIImage *image = [UIImage imageNamed:source];
    if (!image) {
      NSURL *url = [NSURL URLWithString:source];
      if (url.isFileURL) {
        image = [UIImage imageWithContentsOfFile:url.path];
      }
    }
    if (image) {
      [self.markerIconCache setObject:image forKey:[@"src:" stringByAppendingString:source]];
      return image;
    }
    // 3) Remote URL: nothing synchronous to return — the caller will get a
    //    transparent placeholder and we'll patch marker.icon in once the
    //    fetch completes. The cache stays warm for every future marker that
    //    references this URL, which is what makes single↔cluster transitions
    //    instant on the second pass.
    NSURL *remoteURL = [NSURL URLWithString:source];
    if (remoteURL && ([remoteURL.scheme isEqualToString:@"http"] || [remoteURL.scheme isEqualToString:@"https"])) {
      return [self transparentPlaceholderImage];
    }
  }
  // Cluster synthetic markers carry no icon/pinColor — their visual is
  // supplied a frame later via setMarkerView:. Spawn them with a
  // transparent 1×1 placeholder so the GMS default pin never flashes
  // through during that one-frame window (Issue 2).
  NSString *identifier = [RCTConvert NSString:item[@"id"]];
  NSString *pinColor = [RCTConvert NSString:item[@"pinColor"]];
  if ([identifier hasPrefix:@"cluster:"] && pinColor.length == 0) {
    return [self transparentPlaceholderImage];
  }
  return [GMSMarker markerImageWithColor:[self colorFromString:[RCTConvert NSString:item[@"pinColor"]] fallback:UIColor.redColor]];
}

#pragma mark - Async HTTP icon loading

/**
 * Singleton URL session backed by an on-disk URLCache so a 1000-marker map
 * doesn't refetch the same avatar URLs every cold start. The 16 MiB memory
 * / 64 MiB disk caps are sized to comfortably hold ~few thousand small
 * marker icons without bloating the app footprint.
 */
+ (NSURLSession *)sharedIconSession
{
  static NSURLSession *session;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSURLCache *cache = [[NSURLCache alloc] initWithMemoryCapacity:16 * 1024 * 1024
                                                       diskCapacity:64 * 1024 * 1024
                                                           diskPath:@"RNCustomMapIconCache"];
    NSURLSessionConfiguration *config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    config.URLCache = cache;
    config.requestCachePolicy = NSURLRequestReturnCacheDataElseLoad;
    config.HTTPMaximumConnectionsPerHost = 8;
    session = [NSURLSession sessionWithConfiguration:config];
  });
  return session;
}

/**
 * Tracks in-flight icon fetches by URL string. Multiple markers requesting
 * the same image share a single network task — critical for 500-1000+
 * marker maps where dozens of points often reuse the same avatar URL.
 */
- (NSMutableDictionary<NSString *, NSMutableArray *> *)pendingIconFetches
{
  static char key;
  NSMutableDictionary *dict = objc_getAssociatedObject(self, &key);
  if (!dict) {
    dict = [NSMutableDictionary dictionary];
    objc_setAssociatedObject(self, &key, dict, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return dict;
}

- (void)fetchRemoteIconForMarkerId:(NSString *)markerId source:(NSString *)source
{
  if (source.length == 0 || markerId.length == 0) return;
  NSString *cacheKey = [@"src:" stringByAppendingString:source];

  // Cache hit? Apply synchronously and bail.
  UIImage *cached = [self.markerIconCache objectForKey:cacheKey];
  if (cached) {
    GMSMarker *marker = self.markersById[markerId];
    if (marker) {
      marker.icon = cached;
      self.markerIconKeys[markerId] = cacheKey;
    }
    return;
  }

  // Coalesce concurrent requests for the same URL.
  NSMutableDictionary<NSString *, NSMutableArray *> *pending = [self pendingIconFetches];
  NSMutableArray *waiters = pending[source];
  if (waiters) {
    [waiters addObject:markerId];
    return;
  }
  waiters = [NSMutableArray arrayWithObject:markerId];
  pending[source] = waiters;

  NSURL *url = [NSURL URLWithString:source];
  if (!url) {
    [pending removeObjectForKey:source];
    return;
  }
  __weak RNCustomMapNativeView *weakSelf = self;
  NSURLSessionDataTask *task =
    [[RNCustomMapNativeView sharedIconSession] dataTaskWithURL:url
                                             completionHandler:^(NSData *data, __unused NSURLResponse *response, NSError *error) {
      UIImage *image = (data && !error) ? [UIImage imageWithData:data] : nil;
      dispatch_async(dispatch_get_main_queue(), ^{
        RNCustomMapNativeView *strong = weakSelf;
        if (!strong) return;
        NSArray *ids = [strong pendingIconFetches][source];
        [[strong pendingIconFetches] removeObjectForKey:source];
        if (!image) return;
        [strong.markerIconCache setObject:image forKey:cacheKey];
        // Apply to every marker that was waiting for this URL — markers
        // that have been removed in the meantime are simply skipped.
        for (NSString *waiterId in ids) {
          GMSMarker *m = strong.markersById[waiterId];
          if (m && [strong.markerIconKeys[waiterId] isEqualToString:cacheKey]) {
            m.icon = image;
          } else if (m && !strong.markerIconKeys[waiterId]) {
            m.icon = image;
            strong.markerIconKeys[waiterId] = cacheKey;
          }
        }
      });
    }];
  [task resume];
}

/** Static, shared 1×1 transparent UIImage used as a stand-in while a
 *  cluster marker waits for its React snapshot to arrive. */
- (UIImage *)transparentPlaceholderImage
{
  static UIImage *placeholder;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
    format.opaque = NO;
    UIGraphicsImageRenderer *renderer =
        [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(1, 1) format:format];
    placeholder = [renderer imageWithActions:^(__unused UIGraphicsImageRendererContext *ctx) {}];
  });
  return placeholder;
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
