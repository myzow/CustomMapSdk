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
/** GMSAdvancedMarker entries keyed by id (separate pipeline from classic markers). */
@property (nonatomic, strong) NSMutableDictionary<NSString *, GMSMarker *> *advancedMarkersById;
/** Latest React-rendered iconView UIView for each advanced marker id. */
@property (nonatomic, strong) NSMutableDictionary<NSString *, UIView *> *advancedIconViews;
/**
 * Set of marker ids that want live (re-rasterized every pump tick)
 * updates. Membership is driven by the {@code tracksViewChanges} prop.
 */
@property (nonatomic, strong) NSMutableSet<NSString *> *advancedLiveMarkers;
/** Per-marker tracksViewChanges preference (default YES if absent). */
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *advancedTracksChanges;
/**
 * Single CADisplayLink that drives the live-marker rasterization pump.
 * Allocated lazily when the first live marker arrives, invalidated when
 * the last live marker is removed. Throttled to ~30 FPS.
 */
@property (nonatomic, strong, nullable) CADisplayLink *advancedPumpLink;
/** GMUClusterManager kept for spec-compliance and cross-platform parity. */
@property (nonatomic, strong, nullable) id clusterManager;
@property (nonatomic, copy, nullable) NSString *currentMapId;
@property (nonatomic, strong) NSMutableArray<GMSPolyline *> *mapPolylines;
@property (nonatomic, strong) NSMutableArray<GMSCircle *> *mapCircles;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *markerPayloads;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *markerTappables;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSString *> *markerIconSources;
@property (nonatomic, strong) NSCache<NSString *, UIImage *> *iconCache;
@property (nonatomic, strong) NSCache<NSString *, UIImage *> *placeholderCache;
@property (nonatomic, strong) NSCache<NSString *, UIImage *> *viewBitmapCache;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSMutableArray *> *iconWaiters;
@property (nonatomic, copy) NSString *selectedMarkerId;
@property (nonatomic, assign) BOOL lastRegionChangeWasGesture;
@end

@implementation RNCustomMapNativeView

- (instancetype)initWithFrame:(CGRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _mapMarkers = [NSMutableArray new];
    _markersById = [NSMutableDictionary new];
    _advancedMarkersById = [NSMutableDictionary new];
    _advancedIconViews = [NSMutableDictionary new];
    _advancedLiveMarkers = [NSMutableSet new];
    _advancedTracksChanges = [NSMutableDictionary new];
    _currentMapId = @"DEMO_MAP_ID";
    _mapPolylines = [NSMutableArray new];
    _mapCircles = [NSMutableArray new];
    _markerPayloads = [NSMutableDictionary new];
    _markerTappables = [NSMutableDictionary new];
    _markerIconSources = [NSMutableDictionary new];
    _iconWaiters = [NSMutableDictionary new];

    // Process-wide caches. NSCache evicts under memory pressure on its
    // own; we also wipe it manually via UIApplicationDidReceiveMemoryWarning
    // (some devices don't deliver an NSCache eviction until much later).
    _iconCache = [NSCache new];
    _iconCache.name = @"RNCustomMap.iconCache";
    _iconCache.countLimit = 256;
    _placeholderCache = [NSCache new];
    _placeholderCache.name = @"RNCustomMap.placeholderCache";
    _placeholderCache.countLimit = 64;
    _viewBitmapCache = [NSCache new];
    _viewBitmapCache.name = @"RNCustomMap.viewBitmapCache";
    _viewBitmapCache.countLimit = 256;

    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleMemoryWarning)
               name:UIApplicationDidReceiveMemoryWarningNotification
             object:nil];

    GMSCameraPosition *camera = [GMSCameraPosition cameraWithLatitude:0 longitude:0 zoom:1];
    // Construct via GMSMapViewOptions so we can supply a mapID — required by
    // Google Maps for Advanced Markers to render. The SDK ships with the
    // special development ID "DEMO_MAP_ID" so apps can experiment without
    // provisioning a real one; the JS-side `mapId` prop can override at runtime.
    if (@available(iOS 14.0, *)) {
      GMSMapViewOptions *options = [[GMSMapViewOptions alloc] init];
      options.frame = self.bounds;
      options.camera = camera;
      options.mapID = [GMSMapID mapIDWithIdentifier:_currentMapId ?: @"DEMO_MAP_ID"];
      _mapView = [[GMSMapView alloc] initWithOptions:options];
    } else {
      // iOS < 14: Advanced Markers are not supported. Fall back to a legacy map.
      _mapView = [GMSMapView mapWithFrame:self.bounds camera:camera];
    }
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

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  [_advancedPumpLink invalidate];
  _advancedPumpLink = nil;
}

- (void)handleMemoryWarning
{
  [self.iconCache removeAllObjects];
  [self.placeholderCache removeAllObjects];
  [self.viewBitmapCache removeAllObjects];
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
  // ----------------------------------------------------------------
  // Diff-based update — mirrors the Android implementation. The
  // previous logic destroyed and recreated every GMSMarker on every
  // setMarkers call, which is what made the default red pin briefly
  // appear during cluster transitions. We now reuse existing markers
  // and only touch the fields that changed.
  // ----------------------------------------------------------------
  NSMutableDictionary<NSString *, NSDictionary *> *incoming = [NSMutableDictionary new];
  NSMutableArray<NSString *> *incomingOrder = [NSMutableArray new];
  for (NSDictionary *item in markers ?: @[]) {
    NSString *identifier = [RCTConvert NSString:item[@"id"]] ?: @"";
    if (identifier.length == 0) continue;
    incoming[identifier] = item;
    [incomingOrder addObject:identifier];
  }

  // 1) Remove markers that are no longer present.
  NSMutableArray<NSString *> *toRemove = [NSMutableArray new];
  for (NSString *existingId in self.markersById.allKeys) {
    if (!incoming[existingId]) {
      [toRemove addObject:existingId];
    }
  }
  for (NSString *removedId in toRemove) {
    GMSMarker *m = self.markersById[removedId];
    if (m) {
      m.map = nil;
      [self.mapMarkers removeObject:m];
    }
    [self.markersById removeObjectForKey:removedId];
    [self.markerPayloads removeObjectForKey:removedId];
    [self.markerTappables removeObjectForKey:removedId];
    [self.markerIconSources removeObjectForKey:removedId];
    if ([self.selectedMarkerId isEqualToString:removedId]) self.selectedMarkerId = nil;
  }

  // 2) Reuse / create.
  for (NSString *identifier in incomingOrder) {
    NSDictionary *item = incoming[identifier];
    CLLocationCoordinate2D coordinate = CLLocationCoordinate2DMake(
        [item[@"latitude"] doubleValue], [item[@"longitude"] doubleValue]);
    GMSMarker *marker = self.markersById[identifier];
    NSString *newSource = [RCTConvert NSString:item[@"icon"]] ?: [RCTConvert NSString:item[@"image"]];
    NSString *prevSource = self.markerIconSources[identifier];

    if (marker) {
      // Position update — GMS bridges to setPosition which animates by default.
      if (!(marker.position.latitude == coordinate.latitude &&
            marker.position.longitude == coordinate.longitude)) {
        marker.position = coordinate;
      }
      marker.title = [RCTConvert NSString:item[@"title"]];
      marker.snippet = [RCTConvert NSString:item[@"description"]];
      marker.draggable = [RCTConvert BOOL:item[@"draggable"]];
      marker.flat = [RCTConvert BOOL:item[@"flat"]];
      marker.rotation = item[@"rotation"] ? [item[@"rotation"] doubleValue] : marker.rotation;
      marker.opacity = item[@"opacity"] ? [item[@"opacity"] floatValue] : marker.opacity;
      marker.groundAnchor = [self pointFromDictionary:item[@"anchor"] fallback:marker.groundAnchor];
      // Only re-resolve the icon when the source changed.
      if (![self stringsEqual:newSource other:prevSource]) {
        marker.icon = [self markerImageForItem:item];
      }
    } else {
      marker = [GMSMarker markerWithPosition:coordinate];
      marker.title = [RCTConvert NSString:item[@"title"]];
      marker.snippet = [RCTConvert NSString:item[@"description"]];
      marker.draggable = [RCTConvert BOOL:item[@"draggable"]];
      marker.flat = [RCTConvert BOOL:item[@"flat"]];
      marker.rotation = item[@"rotation"] ? [item[@"rotation"] doubleValue] : 0;
      marker.opacity = item[@"opacity"] ? [item[@"opacity"] floatValue] : 1;
      marker.groundAnchor = [self pointFromDictionary:item[@"anchor"] fallback:CGPointMake(0.5, 1)];
      marker.infoWindowAnchor = [self pointFromDictionary:item[@"calloutAnchor"]
                                                fallback:[self pointFromDictionary:item[@"calloutOffset"]
                                                                          fallback:CGPointMake(0.5, 0)]];
      marker.userData = identifier;
      marker.icon = [self markerImageForItem:item];
      marker.tracksViewChanges = item[@"tracksViewChanges"] ? [RCTConvert BOOL:item[@"tracksViewChanges"]] : YES;
      marker.map = self.mapView;
      self.markersById[identifier] = marker;
      [self.mapMarkers addObject:marker];
    }

    self.markerIconSources[identifier] = newSource ?: @"";
    self.markerPayloads[identifier] = @{
      @"id": identifier,
      @"coordinate": @{@"latitude": @(coordinate.latitude), @"longitude": @(coordinate.longitude)},
      @"title": marker.title ?: @"",
      @"description": marker.snippet ?: @""
    };
    self.markerTappables[identifier] = @([self boolFromDictionary:item key:@"tappable" fallback:YES]);

    // Kick off the remote load if needed; the icon already shows the
    // placeholder bitmap so the user never sees the default red pin.
    [self ensureMarkerIcon:marker identifier:identifier source:newSource item:item];
  }
}

#pragma mark - Advanced Markers

- (void)setMapId:(NSString *)mapId
{
  if (mapId.length == 0) return;
  if ([mapId isEqualToString:self.currentMapId]) return;
  NSLog(@"[RNCustomMap] mapId change at runtime (was='%@', new='%@') — GoogleMaps iOS SDK "
        @"requires mapID at construction. Re-mount the host view to apply the new value.",
        self.currentMapId, mapId);
  self.currentMapId = mapId;
}

/**
 * Apply a new advanced-marker set. Mirrors the Android pipeline:
 *   - new entries are created as GMSAdvancedMarker (with iconView when the
 *     JS-side carried children, otherwise a default Maps pin tinted with
 *     pinColor when set)
 *   - existing entries with the same id are updated in place
 *   - entries removed from the incoming list are pulled off the map
 *
 * The JS-side cluster engine has already produced singletons + synthetic
 * cluster bubbles; the native side simply mounts what it receives.
 */
- (void)setAdvancedMarkers:(NSArray *)advancedMarkers
{
  if (![GMSAdvancedMarker class]) return; // SDK < 9.0 — graceful no-op.

  NSMutableDictionary<NSString *, NSDictionary *> *incoming = [NSMutableDictionary new];
  NSMutableArray<NSString *> *order = [NSMutableArray new];
  for (NSDictionary *item in advancedMarkers ?: @[]) {
    NSString *identifier = [RCTConvert NSString:item[@"id"]] ?: @"";
    if (identifier.length == 0) continue;
    incoming[identifier] = item;
    [order addObject:identifier];
  }

  // 1) Remove entries no longer present.
  NSMutableArray<NSString *> *toRemove = [NSMutableArray new];
  for (NSString *existingId in self.advancedMarkersById.allKeys) {
    if (!incoming[existingId]) [toRemove addObject:existingId];
  }
  for (NSString *removedId in toRemove) {
    GMSMarker *m = self.advancedMarkersById[removedId];
    if (m) {
      m.iconView = nil;
      m.map = nil;
    }
    [self.advancedMarkersById removeObjectForKey:removedId];
    [self.advancedIconViews removeObjectForKey:removedId];
    [self.advancedLiveMarkers removeObject:removedId];
    [self.advancedTracksChanges removeObjectForKey:removedId];
  }
  [self updateAdvancedPumpRunning];

  // 2) Add / update.
  for (NSString *identifier in order) {
    NSDictionary *item = incoming[identifier];
    CLLocationCoordinate2D coordinate = CLLocationCoordinate2DMake(
        [item[@"latitude"] doubleValue], [item[@"longitude"] doubleValue]);
    BOOL hasCustomView = [RCTConvert BOOL:item[@"hasCustomView"]];
    // tracksViewChanges defaults to YES (live mode) when not specified.
    BOOL tracksChanges = item[@"tracksViewChanges"] != nil
        ? [RCTConvert BOOL:item[@"tracksViewChanges"]]
        : YES;
    self.advancedTracksChanges[identifier] = @(tracksChanges);

    GMSAdvancedMarker *marker = (GMSAdvancedMarker *)self.advancedMarkersById[identifier];

    if (marker) {
      // Reuse: only update mutable fields. The icon is the exclusive
      // responsibility of -setAdvancedMarkerView:markerId: which keys
      // by content signature and short-circuits no-ops.
      if (!(marker.position.latitude == coordinate.latitude &&
            marker.position.longitude == coordinate.longitude)) {
        marker.position = coordinate;
      }
      marker.title = [RCTConvert NSString:item[@"title"]];
      marker.snippet = [RCTConvert NSString:item[@"description"]];
      marker.draggable = [RCTConvert BOOL:item[@"draggable"]];
      marker.flat = [RCTConvert BOOL:item[@"flat"]];
      marker.rotation = item[@"rotation"] ? [item[@"rotation"] doubleValue] : marker.rotation;
      marker.opacity = item[@"opacity"] ? [item[@"opacity"] floatValue] : marker.opacity;
      marker.groundAnchor = [self pointFromDictionary:item[@"anchor"] fallback:marker.groundAnchor];
      marker.zIndex = item[@"zIndex"] ? [item[@"zIndex"] intValue] : marker.zIndex;
      // For markers without a custom view, refresh the pinColor-tinted
      // default whenever the prop value changes.
      if (!hasCustomView) {
        UIImage *defaultPin = [self advancedDefaultPinForItem:item];
        if (marker.icon != defaultPin) marker.icon = defaultPin;
      }
      continue;
    }

    marker = [GMSAdvancedMarker markerWithPosition:coordinate];
    marker.title = [RCTConvert NSString:item[@"title"]];
    marker.snippet = [RCTConvert NSString:item[@"description"]];
    marker.draggable = [RCTConvert BOOL:item[@"draggable"]];
    marker.flat = [RCTConvert BOOL:item[@"flat"]];
    marker.rotation = item[@"rotation"] ? [item[@"rotation"] doubleValue] : 0;
    marker.opacity = item[@"opacity"] ? [item[@"opacity"] floatValue] : 1;
    marker.groundAnchor = [self pointFromDictionary:item[@"anchor"] fallback:CGPointMake(0.5, 1)];
    marker.zIndex = item[@"zIndex"] ? [item[@"zIndex"] intValue] : 0;
    marker.userData = identifier;
    if (hasCustomView) {
      // Transparent placeholder so the default pin never flashes. The
      // real bitmap arrives via -setAdvancedMarkerView:markerId: shortly.
      marker.icon = [self transparentPlaceholderImage];
      marker.tracksViewChanges = NO;
    } else {
      marker.icon = [self advancedDefaultPinForItem:item];
    }
    marker.map = self.mapView;
    self.advancedMarkersById[identifier] = marker;

    // If we already have a cached snapshot view for this id (from a
    // previous mount in the same session), apply it immediately so the
    // user doesn't see the placeholder.
    UIView *cachedView = self.advancedIconViews[identifier];
    if (hasCustomView && cachedView) {
      [self setAdvancedMarkerView:cachedView markerId:identifier];
    }
  }
}

/**
 * 1x1 transparent placeholder used as the initial icon for advanced
 * markers that carry a React-rendered child view. Replaced as soon as
 * -setAdvancedMarkerView:markerId: lands. Cached so we never allocate
 * more than one of these per process.
 */
- (UIImage *)transparentPlaceholderImage
{
  static UIImage *placeholder;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    UIGraphicsImageRendererFormat *fmt = [UIGraphicsImageRendererFormat preferredFormat];
    fmt.opaque = NO;
    UIGraphicsImageRenderer *renderer =
        [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(1, 1) format:fmt];
    placeholder = [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull ctx) {
      CGContextClearRect(ctx.CGContext, CGRectMake(0, 0, 1, 1));
    }];
  });
  return placeholder;
}

/**
 * Bind a React-rendered native view as the visual for an advanced marker.
 *
 * <p>The View is NEVER reparented out of React's view tree — doing so
 * crashes React Native's Fabric mount layer with "Attempt to unmount a
 * view which is mounted inside different view." Instead the View is
 * left exactly where React put it (the off-screen snapshot subtree) and
 * we snapshot its visual content into a UIImage that GMS displays as
 * the marker icon.
 *
 * <p>Two modes:
 * <ul>
 *   <li><b>Live</b> ({@code tracksViewChanges=YES}, default). The marker
 *       is added to {@code advancedLiveMarkers} and a single per-view
 *       CADisplayLink pump re-snapshots all live markers at ~30 FPS.
 *       Animated.View, Lottie, ActivityIndicator, Reanimated transforms
 *       — anything that repaints itself — appears live on the marker.</li>
 *   <li><b>Static</b> ({@code tracksViewChanges=NO}). One snapshot at
 *       first layout, cached by content signature, no pump. Highest FPS
 *       path; recommended for 500+ marker scenes.</li>
 * </ul>
 *
 * <p>A {@code markerView} of nil is the release sentinel — invoked by
 * JS when React unmounts the snapshot view. We drop the cached reference
 * BEFORE RN deallocates the underlying UIView so the pump never tries
 * to render against a zombie pointer.
 */
- (void)setAdvancedMarkerView:(UIView *)markerView markerId:(NSString *)markerId
{
  if (markerId.length == 0) return;

  // Release path — React just unmounted the snapshot view.
  if (!markerView) {
    [self.advancedIconViews removeObjectForKey:markerId];
    [self.advancedLiveMarkers removeObject:markerId];
    GMSAdvancedMarker *marker = (GMSAdvancedMarker *)self.advancedMarkersById[markerId];
    if (marker) {
      marker.icon = [self transparentPlaceholderImage];
      marker.tracksViewChanges = NO;
    }
    [self updateAdvancedPumpRunning];
    return;
  }

  CGSize size = markerView.bounds.size;
  if (size.width <= 0 || size.height <= 0) {
    return;
  }

  self.advancedIconViews[markerId] = markerView;

  GMSAdvancedMarker *marker = (GMSAdvancedMarker *)self.advancedMarkersById[markerId];
  if (!marker) return;

  NSNumber *tracksBoxed = self.advancedTracksChanges[markerId];
  BOOL tracksChanges = tracksBoxed ? tracksBoxed.boolValue : YES;

  // Immediate one-shot snapshot — fills in the placeholder this frame.
  [self rasterizeAdvancedMarker:markerId
                          source:markerView
                          marker:marker
              useSignatureCache:!tracksChanges
                       fastPath:NO];

  if (tracksChanges) {
    [self.advancedLiveMarkers addObject:markerId];
  } else {
    [self.advancedLiveMarkers removeObject:markerId];
  }
  [self updateAdvancedPumpRunning];
}

/**
 * One-shot rasterization. Cached UIImage keyed by content signature so
 * the static path's cluster recomputes are no-ops.
 *
 * <p>The two callers want very different semantics:
 * <ul>
 *   <li><b>Static path</b> ({@code useSignatureCache=YES}). Capture once,
 *       reuse forever. Uses {@code afterScreenUpdates:YES} so the
 *       captured image reflects any pending layout — fine because we
 *       only do this once.</li>
 *   <li><b>Live pump</b> ({@code useSignatureCache=NO}). Capture each
 *       frame. Critically we must use {@code afterScreenUpdates:YES}
 *       here too — otherwise {@code drawViewHierarchyInRect:} reads the
 *       <i>model</i> layer state, which lags one frame behind any
 *       useNativeDriver animation running on the <i>presentation</i>
 *       layer. That mismatch is exactly what produces the visible
 *       judder / blink users see when an animated marker pulses at
 *       30 FPS. With {@code YES} the call forces a model-layer sync to
 *       the current presentation state before snapshotting, which
 *       costs an extra layout pass but eliminates the flicker.</li>
 * </ul>
 *
 * <p>We also skip the {@code marker.icon = image} setter when the
 * pointer already matches — GMS treats this as a no-op internally but
 * verifying here avoids an extra ObjC message dispatch + the
 * {@code groundAnchor} / {@code tracksViewChanges} setters that follow.
 */
- (void)rasterizeAdvancedMarker:(NSString *)markerId
                          source:(UIView *)reactView
                          marker:(GMSAdvancedMarker *)marker
              useSignatureCache:(BOOL)useSignatureCache
                       fastPath:(BOOL)fastPath
{
  CGSize size = reactView.bounds.size;
  if (size.width <= 0 || size.height <= 0) return;

  NSString *signature = nil;
  if (useSignatureCache) {
    signature = [NSString stringWithFormat:@"%@:%p:%.0fx%.0f",
                 markerId, (void *)reactView, size.width, size.height];
    UIImage *prev = [self.viewBitmapCache objectForKey:signature];
    if (prev) {
      if (marker.icon != prev) {
        if (marker.iconView) marker.iconView = nil;
        marker.icon = prev;
        marker.groundAnchor = CGPointMake(0.5, 1);
        marker.tracksViewChanges = NO;
      }
      return;
    }
  }

  UIGraphicsImageRendererFormat *fmt = [UIGraphicsImageRendererFormat preferredFormat];
  fmt.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:fmt];
  // fastPath=YES is the pump-tick caller, which has already issued a
  // global CATransaction flush — model layer is already in sync, so we
  // can use the cheap afterScreenUpdates:NO. fastPath=NO is the
  // one-shot caller (initial bind / static path) where we don't know
  // the model-layer state and need YES to force a sync.
  BOOL afterUpdates = !fastPath;
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull ctx) {
    [reactView drawViewHierarchyInRect:reactView.bounds afterScreenUpdates:afterUpdates];
  }];
  if (useSignatureCache && signature) {
    [self.viewBitmapCache setObject:image forKey:signature];
  }
  if (marker.iconView) marker.iconView = nil;
  marker.icon = image;
  marker.groundAnchor = CGPointMake(0.5, 1);
  marker.tracksViewChanges = NO;
}

/**
 * Start or stop the per-view CADisplayLink pump based on whether any
 * markers want live updates. The link is throttled to ~30 FPS via
 * {@code preferredFramesPerSecond}.
 */
- (void)updateAdvancedPumpRunning
{
  BOOL shouldRun = self.advancedLiveMarkers.count > 0;
  if (shouldRun && !self.advancedPumpLink) {
    CADisplayLink *link = [CADisplayLink displayLinkWithTarget:self
                                                     selector:@selector(pumpAdvancedLiveMarkers:)];
    // Run at the display's native refresh rate so the captured animation
    // state matches what the display can actually show. 30 FPS (the
    // previous setting) was the source of the visible judder users
    // reported as "blinking": the React animation runs at 60 FPS, was
    // sampled at 30, displayed at 60 — every other display frame held
    // the previous capture, producing a stair-step rhythm regardless of
    // how smooth the source animation was.
    if (@available(iOS 15.0, *)) {
      link.preferredFrameRateRange = CAFrameRateRangeMake(30.0f, 60.0f, 60.0f);
    } else {
      link.preferredFramesPerSecond = 60;
    }
    [link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    self.advancedPumpLink = link;
  } else if (!shouldRun && self.advancedPumpLink) {
    [self.advancedPumpLink invalidate];
    self.advancedPumpLink = nil;
  }
}

- (void)pumpAdvancedLiveMarkers:(CADisplayLink *)sender
{
  // One synchronous Core Animation commit at the start of the pump
  // tick — flushes all pending animation state (useNativeDriver
  // transforms, Lottie frame advances, ActivityIndicator rotation)
  // into the model layer. With the model layer now in sync, each
  // per-marker snapshot can use the much cheaper
  // afterScreenUpdates:NO. Net effect: one commit per frame for the
  // whole map instead of N commits (one per marker), and the captured
  // images all reflect the same render-server state — no inter-marker
  // tearing.
  [CATransaction flush];

  NSArray<NSString *> *ids = self.advancedLiveMarkers.allObjects;
  for (NSString *markerId in ids) {
    UIView *src = self.advancedIconViews[markerId];
    GMSAdvancedMarker *marker = (GMSAdvancedMarker *)self.advancedMarkersById[markerId];
    if (!src || !marker) continue;
    [self rasterizeAdvancedMarker:markerId
                            source:src
                            marker:marker
                useSignatureCache:NO
                       fastPath:YES];
  }
}

/**
 * Default Advanced Marker icon. Honors `pinColor` when supplied; otherwise
 * returns nil so GMSAdvancedMarker uses its stock pin appearance.
 */
- (UIImage *)advancedDefaultPinForItem:(NSDictionary *)item
{
  NSString *pinColor = [RCTConvert NSString:item[@"pinColor"]];
  if (pinColor.length == 0) return nil;
  UIColor *color = [self colorFromString:pinColor fallback:UIColor.redColor];
  return [GMSMarker markerImageWithColor:color];
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
  // Rasterize the React-rendered view ONCE and reuse the resulting image
  // on subsequent re-binds (cluster recomputes). Without this cache the
  // GMSMarker would briefly flash its previous icon while the new
  // iconView's first frame was being laid out.
  CGSize size = markerView.bounds.size;
  if (size.width <= 0 || size.height <= 0) {
    marker.iconView = markerView;
    marker.tracksViewChanges = YES;
    return;
  }
  NSString *cacheKey = [NSString stringWithFormat:@"view:%@:%p:%.0fx%.0f",
                        markerId, (void *)markerView, size.width, size.height];
  UIImage *cached = [self.viewBitmapCache objectForKey:cacheKey];
  if (!cached) {
    UIGraphicsImageRendererFormat *fmt = [UIGraphicsImageRendererFormat preferredFormat];
    fmt.opaque = NO;
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:fmt];
    cached = [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull ctx) {
      [markerView drawViewHierarchyInRect:markerView.bounds afterScreenUpdates:YES];
    }];
    [self.viewBitmapCache setObject:cached forKey:cacheKey];
  }
  marker.icon = cached;
  marker.groundAnchor = CGPointMake(0.5, 1);
  // tracksViewChanges = NO so GMS doesn't try to keep redrawing a UIView
  // we've already rasterized. The render-then-cache pattern is what
  // eliminates the per-frame flicker on cluster transitions.
  marker.tracksViewChanges = NO;
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
    // Bundled asset / file URL — synchronous.
    UIImage *bundled = [UIImage imageNamed:source];
    if (bundled) return bundled;
    NSURL *url = [NSURL URLWithString:source];
    if (url.isFileURL) {
      UIImage *file = [UIImage imageWithContentsOfFile:url.path];
      if (file) return file;
    }
    // Remote URL — check the cache; otherwise fall through to placeholder.
    UIImage *cached = [self.iconCache objectForKey:source];
    if (cached) return cached;
  }
  return [self placeholderImageForItem:item];
}

/**
 * Builds (or fetches from cache) the colored-disc placeholder that's shown
 * as the very first icon for any marker whose real bitmap hasn't landed
 * yet. The platform-default red pin is NEVER returned from this method —
 * even when no fallback config is supplied, a neutral blue disc is drawn.
 */
- (UIImage *)placeholderImageForItem:(NSDictionary *)item
{
  NSString *discColorString = [RCTConvert NSString:item[@"fallbackColor"]];
  NSString *ringColorString = [RCTConvert NSString:item[@"fallbackRingColor"]];
  NSString *initialString = [RCTConvert NSString:item[@"fallbackInitial"]];
  NSString *pinColorString = [RCTConvert NSString:item[@"pinColor"]];
  UIColor *discColor =
      [self colorFromString:discColorString
                   fallback:[self colorFromString:pinColorString
                                         fallback:[UIColor colorWithRed:0.122 green:0.435 blue:0.922 alpha:1]]];
  UIColor *ringColor = [self colorFromString:ringColorString fallback:UIColor.whiteColor];
  NSString *initial = initialString.length > 0 ? [initialString substringToIndex:1] : @"";

  CGFloat size = 42.0;
  NSString *key = [NSString stringWithFormat:@"ph:%@:%@:%@:%.0f",
                   discColorString ?: @"", ringColorString ?: @"", initial, size];
  UIImage *existing = [self.placeholderCache objectForKey:key];
  if (existing) return existing;

  UIGraphicsImageRendererFormat *fmt = [UIGraphicsImageRendererFormat preferredFormat];
  fmt.opaque = NO;
  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc]
      initWithSize:CGSizeMake(size, size) format:fmt];
  UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext * _Nonnull ctx) {
    CGContextRef cg = ctx.CGContext;
    // Ring
    CGContextSetFillColorWithColor(cg, ringColor.CGColor);
    CGContextFillEllipseInRect(cg, CGRectMake(0, 0, size, size));
    // Inner disc inset by 2.5pt so the ring is visible
    CGContextSetFillColorWithColor(cg, discColor.CGColor);
    CGContextFillEllipseInRect(cg, CGRectMake(2.5, 2.5, size - 5, size - 5));
    if (initial.length > 0) {
      NSDictionary *attrs = @{
        NSFontAttributeName: [UIFont boldSystemFontOfSize:size * 0.5],
        NSForegroundColorAttributeName: UIColor.whiteColor
      };
      CGSize textSize = [initial sizeWithAttributes:attrs];
      [[initial uppercaseString]
          drawAtPoint:CGPointMake((size - textSize.width) / 2, (size - textSize.height) / 2)
       withAttributes:attrs];
    }
  }];
  [self.placeholderCache setObject:image forKey:key];
  return image;
}

/**
 * Async loader. If the source URL is remote and not already cached, fetch
 * it on a background queue and swap the marker's icon when it lands.
 * Identical URLs requested concurrently share a single in-flight request
 * via the `iconWaiters` map.
 */
- (void)ensureMarkerIcon:(GMSMarker *)marker
              identifier:(NSString *)identifier
                  source:(NSString *)source
                    item:(NSDictionary *)item
{
  if (source.length == 0) return;
  if (![source hasPrefix:@"http://"] && ![source hasPrefix:@"https://"]) return;
  UIImage *cached = [self.iconCache objectForKey:source];
  if (cached) {
    marker.icon = cached;
    return;
  }

  __weak __typeof(self) weakSelf = self;
  void (^onReady)(UIImage *) = ^(UIImage *image) {
    __strong __typeof(self) strongSelf = weakSelf;
    if (!strongSelf) return;
    GMSMarker *current = strongSelf.markersById[identifier];
    if (current != marker) return; // marker was recycled
    marker.icon = image;
  };

  @synchronized (self.iconWaiters) {
    NSMutableArray *existing = self.iconWaiters[source];
    if (existing) {
      [existing addObject:[onReady copy]];
      return;
    }
    self.iconWaiters[source] = [@[[onReady copy]] mutableCopy];
  }

  NSURL *url = [NSURL URLWithString:source];
  if (!url) {
    [self flushIconWaitersForSource:source withImage:nil];
    return;
  }
  NSURLSessionDataTask *task = [[NSURLSession sharedSession]
      dataTaskWithURL:url
    completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        UIImage *image = (data && !error) ? [UIImage imageWithData:data] : nil;
        __strong __typeof(self) strongSelf = weakSelf;
        if (image && strongSelf) {
          [strongSelf.iconCache setObject:image forKey:source];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
          __strong __typeof(self) self2 = weakSelf;
          if (self2) [self2 flushIconWaitersForSource:source withImage:image];
        });
    }];
  [task resume];
}

- (void)flushIconWaitersForSource:(NSString *)source withImage:(UIImage *)image
{
  NSArray *waiters;
  @synchronized (self.iconWaiters) {
    waiters = self.iconWaiters[source];
    [self.iconWaiters removeObjectForKey:source];
  }
  if (!image) return;
  for (void (^block)(UIImage *) in waiters) {
    block(image);
  }
}

- (void)prefetchMarkerIcons:(NSArray<NSString *> *)urls
{
  for (NSString *u in urls ?: @[]) {
    if (![u isKindOfClass:[NSString class]] || u.length == 0) continue;
    if ([self.iconCache objectForKey:u]) continue;
    if (![u hasPrefix:@"http://"] && ![u hasPrefix:@"https://"]) continue;
    __weak __typeof(self) weakSelf = self;
    NSURL *url = [NSURL URLWithString:u];
    if (!url) continue;
    @synchronized (self.iconWaiters) {
      if (self.iconWaiters[u]) continue; // already in flight
      // Empty waiters array — load is pending but nobody is listening.
      self.iconWaiters[u] = [NSMutableArray new];
    }
    NSURLSessionDataTask *task = [[NSURLSession sharedSession]
        dataTaskWithURL:url
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          UIImage *image = (data && !error) ? [UIImage imageWithData:data] : nil;
          __strong __typeof(self) strongSelf = weakSelf;
          if (image && strongSelf) {
            [strongSelf.iconCache setObject:image forKey:u];
          }
          dispatch_async(dispatch_get_main_queue(), ^{
            __strong __typeof(self) self2 = weakSelf;
            if (self2) [self2 flushIconWaitersForSource:u withImage:image];
          });
      }];
    [task resume];
  }
}

- (void)clearMarkerIconCache
{
  [self.iconCache removeAllObjects];
  [self.placeholderCache removeAllObjects];
  [self.viewBitmapCache removeAllObjects];
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

static NSArray *RNCustomMapAdvancedMarkersArray(const std::vector<RNCustomMapViewAdvancedMarkersStruct> &markers)
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
      @"draggable": @(marker.draggable),
      @"flat": @(marker.flat),
      @"rotation": @(marker.rotation),
      @"opacity": @(marker.opacity),
      @"zIndex": @(marker.zIndex),
      @"hasCustomView": @(marker.hasCustomView),
      @"isCluster": @(marker.isCluster),
      @"tracksViewChanges": @(marker.tracksViewChanges)
    } mutableCopy];
    item[@"anchor"] = @{@"x": @(marker.anchor.x), @"y": @(marker.anchor.y)};
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
  if (mapProps.mapId != oldMapProps.mapId) {
    [_nativeMapView setMapId:RNCustomMapNSString(mapProps.mapId)];
  }
  [_nativeMapView setMarkers:RNCustomMapMarkersArray(mapProps.markers)];
  [_nativeMapView setAdvancedMarkers:RNCustomMapAdvancedMarkersArray(mapProps.advancedMarkers)];
  [_nativeMapView setPolylines:RNCustomMapPolylinesArray(mapProps.polylines)];
  [_nativeMapView setCircles:RNCustomMapCirclesArray(mapProps.circles)];

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [_nativeMapView setMarkers:@[]];
  [_nativeMapView setAdvancedMarkers:@[]];
  [_nativeMapView setPolylines:@[]];
  [_nativeMapView setCircles:@[]];
  _nativeMapView.initialRegionApplied = NO;
}

- (RNCustomMapNativeView *)nativeMapView
{
  return _nativeMapView;
}

@end
