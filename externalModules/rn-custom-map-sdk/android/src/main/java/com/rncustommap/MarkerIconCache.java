package com.rncustommap;

import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.LruCache;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.bumptech.glide.Glide;
import com.bumptech.glide.request.target.CustomTarget;
import com.bumptech.glide.request.transition.Transition;
import com.google.android.gms.maps.model.BitmapDescriptor;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Process-wide cache of marker bitmaps + their BitmapDescriptor wrappers.
 *
 * <p>This is the linchpin of the no-flicker pipeline. Without it, every
 * time the JS layer pushes a fresh marker set (which happens on every
 * cluster recompute) Glide would re-decode each remote image from disk —
 * during which window Google Maps shows the default red pin. With it, the
 * second-and-subsequent marker payloads hit the cache instantly.
 *
 * <p>Design choices:
 * <ul>
 *   <li>Keyed by URL string. We don't bucket by size because the JS layer
 *       guarantees a single rendered size per URL.</li>
 *   <li>LRU eviction with a bitmap-byte budget rather than entry count, so
 *       a few large avatars don't push out dozens of small icons.</li>
 *   <li>Implements {@link ComponentCallbacks2} so the OS can ask us to
 *       free memory under pressure.</li>
 *   <li>Synthesizes a placeholder bitmap on demand (colored disc + optional
 *       initial). These placeholders are also cached, keyed by the visual
 *       parameters, so we never re-draw the same disc twice.</li>
 * </ul>
 */
public final class MarkerIconCache implements ComponentCallbacks2 {

  /** Singleton — single cache shared across all RNCustomMapView instances. */
  private static volatile MarkerIconCache instance;

  /** Default cache budget — 8 MB. Tweakable from the JS side later. */
  private static final int DEFAULT_BUDGET_BYTES = 8 * 1024 * 1024;

  /**
   * Generic listener so the View can refresh markers when an image lands
   * asynchronously. The cache itself doesn't drive any UI.
   */
  public interface IconReadyListener {
    void onIconReady(@NonNull String url, @NonNull BitmapDescriptor descriptor);
    void onIconFailed(@NonNull String url);
  }

  // --- LRU keyed by URL with size measured in bytes ---
  private final LruCache<String, CachedEntry> remoteCache;
  // --- Placeholders are cached separately by their visual parameters ---
  private final Map<String, BitmapDescriptor> placeholderCache =
      Collections.synchronizedMap(new HashMap<>());
  // --- In-flight Glide targets so we don't issue duplicate requests ---
  private final Map<String, List<IconReadyListener>> waitingListeners =
      Collections.synchronizedMap(new HashMap<>());

  private MarkerIconCache(int budgetBytes) {
    this.remoteCache = new LruCache<String, CachedEntry>(Math.max(budgetBytes, 1)) {
      @Override
      protected int sizeOf(@NonNull String key, @NonNull CachedEntry value) {
        // BitmapDescriptor itself doesn't expose its byte size, so we
        // track the original bitmap's allocation as a proxy.
        return value.byteCount;
      }
    };
  }

  @NonNull
  public static MarkerIconCache get(@NonNull Context context) {
    if (instance == null) {
      synchronized (MarkerIconCache.class) {
        if (instance == null) {
          instance = new MarkerIconCache(DEFAULT_BUDGET_BYTES);
          context.getApplicationContext().registerComponentCallbacks(instance);
        }
      }
    }
    return instance;
  }

  /** Lookup or null. Never blocks; returns immediately. */
  @Nullable
  public BitmapDescriptor lookup(@NonNull String url) {
    CachedEntry e = remoteCache.get(url);
    return e == null ? null : e.descriptor;
  }

  /**
   * Request the bitmap for `url`. The listener fires once — either with the
   * cached descriptor (synchronously if already present), or asynchronously
   * after Glide finishes loading. Failures fire onIconFailed.
   */
  public void requestRemote(
      @NonNull Context context, @NonNull final String url, @NonNull IconReadyListener listener) {
    BitmapDescriptor cached = lookup(url);
    if (cached != null) {
      listener.onIconReady(url, cached);
      return;
    }
    synchronized (waitingListeners) {
      List<IconReadyListener> waiting = waitingListeners.get(url);
      if (waiting != null) {
        waiting.add(listener);
        return; // a Glide request is already in flight
      }
      waiting = new ArrayList<>();
      waiting.add(listener);
      waitingListeners.put(url, waiting);
    }

    Glide.with(context.getApplicationContext()).asBitmap().load(url).into(
        new CustomTarget<Bitmap>() {
          @Override
          public void onResourceReady(@NonNull Bitmap resource, @Nullable Transition<? super Bitmap> transition) {
            BitmapDescriptor desc = BitmapDescriptorFactory.fromBitmap(resource);
            remoteCache.put(url, new CachedEntry(desc, resource.getByteCount()));
            flush(url, /* success */ desc);
          }

          @Override
          public void onLoadCleared(@Nullable android.graphics.drawable.Drawable placeholder) {
            // Glide cleared the target without delivering — treat like a soft failure.
            flush(url, /* success */ null);
          }

          @Override
          public void onLoadFailed(@Nullable android.graphics.drawable.Drawable errorDrawable) {
            flush(url, /* success */ null);
          }
        });
  }

  /** Prefetch helper — fire-and-forget warm-up, used by the JS prefetch API. */
  public void prefetch(@NonNull Context context, @NonNull String url) {
    if (lookup(url) != null) return;
    requestRemote(
        context,
        url,
        new IconReadyListener() {
          @Override
          public void onIconReady(@NonNull String u, @NonNull BitmapDescriptor d) {}

          @Override
          public void onIconFailed(@NonNull String u) {}
        });
  }

  /** Drop all entries — used on explicit clear() and on memory warnings. */
  public void clear() {
    remoteCache.evictAll();
    placeholderCache.clear();
  }

  // ===================================================================
  // Placeholder bitmaps — used as the FIRST icon for every marker so the
  // default Google pin never appears.
  // ===================================================================

  /**
   * Returns (and caches) a colored disc bitmap descriptor. The descriptor
   * is keyed on (color, ringColor, initial, size) so two markers with the
   * same fallback config share the same descriptor.
   */
  @NonNull
  public BitmapDescriptor placeholder(
      int discColor, int ringColor, @Nullable String initial, int sizePx) {
    String key = "ph:" + discColor + ":" + ringColor + ":" + (initial == null ? "" : initial) + ":" + sizePx;
    BitmapDescriptor existing = placeholderCache.get(key);
    if (existing != null) return existing;

    Bitmap bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

    // Outer ring
    paint.setColor(ringColor);
    canvas.drawCircle(sizePx / 2f, sizePx / 2f, sizePx / 2f, paint);
    // Inner disc (inset by 2px so the ring is visible)
    paint.setColor(discColor);
    canvas.drawCircle(sizePx / 2f, sizePx / 2f, sizePx / 2f - 2.5f, paint);

    if (initial != null && initial.length() > 0) {
      char ch = Character.toUpperCase(initial.charAt(0));
      Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
      textPaint.setColor(Color.WHITE);
      textPaint.setTextAlign(Paint.Align.CENTER);
      textPaint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
      textPaint.setTextSize(sizePx * 0.5f);
      Paint.FontMetrics fm = textPaint.getFontMetrics();
      float baseline = sizePx / 2f - (fm.ascent + fm.descent) / 2f;
      canvas.drawText(String.valueOf(ch), sizePx / 2f, baseline, textPaint);
    }

    BitmapDescriptor desc = BitmapDescriptorFactory.fromBitmap(bmp);
    placeholderCache.put(key, desc);
    return desc;
  }

  // ===================================================================
  // ComponentCallbacks2 — release memory under pressure
  // ===================================================================

  @Override
  public void onTrimMemory(int level) {
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
      // Drop placeholders first (cheap to regenerate); keep recently-used
      // remote bitmaps for one more grace period.
      placeholderCache.clear();
    }
    if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
      remoteCache.evictAll();
    }
  }

  @Override
  public void onConfigurationChanged(@NonNull Configuration newConfig) {
    // No-op — bitmaps are size-fixed.
  }

  @Override
  public void onLowMemory() {
    clear();
  }

  // ===================================================================
  // Plumbing
  // ===================================================================

  private void flush(@NonNull String url, @Nullable BitmapDescriptor descOrNull) {
    List<IconReadyListener> waiting;
    synchronized (waitingListeners) {
      waiting = waitingListeners.remove(url);
    }
    if (waiting == null) return;
    for (IconReadyListener l : waiting) {
      if (descOrNull != null) l.onIconReady(url, descOrNull);
      else l.onIconFailed(url);
    }
  }

  private static final class CachedEntry {
    final BitmapDescriptor descriptor;
    final int byteCount;

    CachedEntry(BitmapDescriptor descriptor, int byteCount) {
      this.descriptor = descriptor;
      this.byteCount = byteCount;
    }
  }
}
