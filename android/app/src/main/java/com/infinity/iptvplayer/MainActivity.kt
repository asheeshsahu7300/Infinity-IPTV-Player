package com.infinity.iptvplayer
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.app.UiModeManager
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    pinHandsetToPortrait()
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    configureCutoutMode()
    hideSystemUI()
  }

  override fun onResume() {
    super.onResume()
    hideSystemUI()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      hideSystemUI()
    }
  }

  private fun configureCutoutMode() {
    try {
      // Android 15 & API 30+: use LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS instead of deprecated SHORT_EDGES or DEFAULT
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        window.attributes.layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
      }
    } catch (e: Exception) {}
  }

  private fun hideSystemUI() {
    try {
      WindowCompat.setDecorFitsSystemWindows(window, false)
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
    } catch (e: Exception) {}
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
   * Move task to background instead of finishing MainActivity when back is
   * pressed at root level or when returning from system TV settings panel.
   */
  override fun invokeDefaultOnBackPressed() {
      if (!moveTaskToBack(true)) {
          super.invokeDefaultOnBackPressed()
      }
  }

  override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
    return try {
      super.onKeyDown(keyCode, event)
    } catch (e: Exception) {
      false
    }
  }

  override fun onKeyUp(keyCode: Int, event: android.view.KeyEvent?): Boolean {
    return try {
      super.onKeyUp(keyCode, event)
    } catch (e: Exception) {
      false
    }
  }

  override fun onKeyMultiple(keyCode: Int, repeatCount: Int, event: android.view.KeyEvent?): Boolean {
    return try {
      super.onKeyMultiple(keyCode, repeatCount, event)
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Strictly upright on a handset. Injected by plugins/withHandsetPortrait.js —
   * edit the plugin, not this file, or the next prebuild will drop the change.
   *
   * Android 16 / Large Screen & Foldables Compliance:
   * Ignores orientation lock if in multi-window mode or on large screen / foldable
   * displays (swDp >= 600) to adhere to Android 16 resizability standards.
   */
  private fun pinHandsetToPortrait() {
    try {
      // Do not restrict orientation in multi-window / split-screen mode
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInMultiWindowMode) {
        return
      }
      val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
      val isTelevision =
        uiModeManager?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
      val swDp = resources.configuration.smallestScreenWidthDp
      // Only lock small phone screens (<480dp). Never lock tablets, foldables (swDp >= 600), or TVs.
      val isHandset = swDp < 480
      if (!isTelevision && isHandset) {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      }
    } catch (e: Exception) {}
  }
}
