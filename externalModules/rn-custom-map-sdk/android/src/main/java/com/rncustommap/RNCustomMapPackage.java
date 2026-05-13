package com.rncustommap;

import androidx.annotation.NonNull;
import com.facebook.react.TurboReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.annotations.ReactModule;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.facebook.react.uimanager.ViewManager;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@ReactModule(name = RNCustomMapModule.NAME)
public class RNCustomMapPackage extends TurboReactPackage {
  @Override
  public NativeModule getModule(@NonNull String name, @NonNull ReactApplicationContext context) {
    if (RNCustomMapModule.NAME.equals(name)) {
      return new RNCustomMapModule(context);
    }
    return null;
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> {
      Map<String, ReactModuleInfo> modules = new HashMap<>();
      modules.put(
          RNCustomMapModule.NAME,
          new ReactModuleInfo(
              RNCustomMapModule.NAME,
              RNCustomMapModule.NAME,
              false,
              false,
              true,
              false,
              true));
      return modules;
    };
  }

  @Override
  public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext context) {
    return Arrays.<ViewManager>asList(new RNCustomMapViewManager(context));
  }
}
