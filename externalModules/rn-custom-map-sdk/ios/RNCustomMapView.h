#import <UIKit/UIKit.h>
#import <React/RCTComponent.h>
#import <React/RCTViewComponentView.h>

@interface RNCustomMapNativeView : UIView

@property (nonatomic, assign) BOOL initialRegionApplied;
@property (nonatomic, copy) RCTBubblingEventBlock onPress;
@property (nonatomic, copy) RCTBubblingEventBlock onLongPress;
@property (nonatomic, copy) RCTDirectEventBlock onRegionChange;
@property (nonatomic, copy) RCTDirectEventBlock onRegionChangeComplete;
@property (nonatomic, copy) RCTDirectEventBlock onMapReady;
@property (nonatomic, copy) RCTDirectEventBlock onUserLocationChange;
@property (nonatomic, copy) RCTBubblingEventBlock onMarkerPress;
@property (nonatomic, copy) RCTBubblingEventBlock onMarkerSelect;
@property (nonatomic, copy) RCTBubblingEventBlock onMarkerDeselect;
@property (nonatomic, copy) RCTBubblingEventBlock onMarkerDragStart;
@property (nonatomic, copy) RCTBubblingEventBlock onMarkerDrag;
@property (nonatomic, copy) RCTBubblingEventBlock onMarkerDragEnd;
@property (nonatomic, copy) RCTBubblingEventBlock onCalloutPress;
@property (nonatomic, copy) RCTBubblingEventBlock onPolylinePress;

- (void)setProvider:(NSString *)provider;
- (void)setMapTypeString:(NSString *)mapType;
- (void)setShowsUserLocation:(BOOL)showsUserLocation;
- (void)setZoomEnabled:(BOOL)zoomEnabled;
- (void)setScrollEnabled:(BOOL)scrollEnabled;
- (void)setRotateEnabled:(BOOL)rotateEnabled;
- (void)setPitchEnabled:(BOOL)pitchEnabled;
- (void)setMinZoomLevel:(NSNumber *)minZoomLevel;
- (void)setMaxZoomLevel:(NSNumber *)maxZoomLevel;
- (void)setCustomMapStyle:(NSString *)customMapStyle;
- (void)setMarkers:(NSArray *)markers;
- (void)setPolylines:(NSArray *)polylines;
- (void)setCircles:(NSArray *)circles;
- (NSArray *)currentMarkers;
- (NSDictionary *)currentCamera;
- (void)setCamera:(NSDictionary *)camera duration:(NSInteger)duration;
- (void)animateToRegion:(NSDictionary *)region duration:(NSInteger)duration;
- (void)animateToCoordinate:(NSDictionary *)coordinate duration:(NSInteger)duration;
- (void)fitToCoordinates:(NSArray *)coordinates options:(NSDictionary *)options;
- (void)fitToElements:(NSDictionary *)options;
- (void)fitToSuppliedMarkers:(NSArray *)markerIds options:(NSDictionary *)options;
- (void)showMarkerCallout:(NSString *)markerId;
- (void)hideMarkerCallout:(NSString *)markerId;
- (void)redrawMarker:(NSString *)markerId;
- (void)animateMarkerToCoordinate:(NSString *)markerId coordinate:(NSDictionary *)coordinate options:(NSDictionary *)options;
- (void)setMarkerView:(UIView *)markerView markerId:(NSString *)markerId;

@end

@interface RNCustomMapView : RCTViewComponentView
- (RNCustomMapNativeView *)nativeMapView;
@end
