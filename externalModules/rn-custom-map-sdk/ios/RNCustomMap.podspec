require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name         = "rn-custom-map-sdk"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://example.com/rn-custom-map-sdk"
  s.license      = "MIT"
  s.author       = { "rn-custom-map-sdk" => "dev@example.com" }
  s.platforms    = { :ios => "14.0" }
  s.source       = { :git => "https://example.com/rn-custom-map-sdk.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.requires_arc = true
  s.frameworks   = "CoreLocation"
  s.dependency "React-Core"
  s.dependency "GoogleMaps"
  # Spec-required dependency for AdvancedMarker clustering via GMUClusterManager.
  s.dependency "Google-Maps-iOS-Utils"
  install_modules_dependencies(s)
end
