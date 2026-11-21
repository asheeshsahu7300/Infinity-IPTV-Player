# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── General JNI & Annotation Keep Rules ─────────────────────────────────────
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepclasseswithmembernames class * {
    native <methods>;
}
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keep @androidx.annotation.Keep class * { *; }
-keepclassmembers class * {
    @androidx.annotation.Keep *;
}

# ── React Native Core & Fabric / TurboModules ──────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.react.**

# ── React Native Reanimated & Screens ───────────────────────────────────────
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-dontwarn com.swmansion.reanimated.**
-dontwarn com.swmansion.rnscreens.**

# ── Expo Modules Architecture ───────────────────────────────────────────────
-keep class expo.modules.** { *; }
-keep interface expo.modules.** { *; }
-dontwarn expo.modules.**

# ── Expo Video & AndroidX Media3 / ExoPlayer ────────────────────────────────
-keep class androidx.media3.** { *; }
-keep interface androidx.media3.** { *; }
-dontwarn androidx.media3.**
-keep class org.jellyfin.media3.** { *; }
-keep class androidx.media3.decoder.ffmpeg.** { *; }
-dontwarn org.jellyfin.media3.**

# ── MMKV & Storage ──────────────────────────────────────────────────────────
-keep class com.tencent.mmkv.** { *; }
-dontwarn com.tencent.mmkv.**

# ── OkHttp & Okio ───────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ── Kotlin Coroutines & Reflection ──────────────────────────────────────────
-keepattributes EnclosingMethod,InnerClasses
-dontwarn kotlin.**
-dontwarn kotlinx.coroutines.**
