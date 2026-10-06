package com.infinity.mediaplayer.ui

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import com.infinity.mediaplayer.core.InfinityPlayer
import com.infinity.mediaplayer.core.InfinityPlayerListener

@OptIn(UnstableApi::class)
class InfinityPlayerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr), InfinityPlayerListener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var boundPlayer: InfinityPlayer? = null

    val playerView: PlayerView = PlayerView(context).apply {
        useController = false
        setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
        setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
        setKeepContentOnPlayerReset(true)
    }

    // Hardware-accelerated NVC neural concealment frame render layer
    private val nvcRenderLayer: ImageView = ImageView(context).apply {
        layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        scaleType = ImageView.ScaleType.FIT_CENTER
        // Enable bilinear hardware filtering for smooth GPU upscaling to display resolution
        val paint = android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG or android.graphics.Paint.ANTI_ALIAS_FLAG)
        setLayerType(View.LAYER_TYPE_HARDWARE, paint)
        visibility = View.GONE
    }

    private var hideRunnable: Runnable? = null

    val subtitleView: SubtitleView?
        get() = playerView.subtitleView

    init {
        addView(playerView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(nvcRenderLayer)
    }

    fun attachPlayer(infinityPlayer: InfinityPlayer) {
        boundPlayer?.removeListener(this)
        boundPlayer = infinityPlayer
        playerView.player = infinityPlayer.exoPlayer
        infinityPlayer.addListener(this)
    }

    fun detachPlayer() {
        boundPlayer?.removeListener(this)
        boundPlayer = null
        playerView.player = null
        nvcRenderLayer.visibility = View.GONE
    }

    override fun onConcealedFrameRendered(bitmap: Bitmap) {
        mainHandler.post {
            hideRunnable?.let { mainHandler.removeCallbacks(it) }
            nvcRenderLayer.setImageBitmap(bitmap)
            nvcRenderLayer.visibility = View.VISIBLE

            // Automatically clear overlay once next decoded hardware frame renders
            val runnable = Runnable {
                nvcRenderLayer.visibility = View.GONE
            }
            hideRunnable = runnable
            mainHandler.postDelayed(runnable, 65)
        }
    }

    override fun onPlaybackStateChanged(isPlaying: Boolean, isBuffering: Boolean) {
        if (isPlaying && !isBuffering) {
            mainHandler.post {
                nvcRenderLayer.visibility = View.GONE
            }
        }
    }

    fun setContentFit(contentFit: String) {
        val (resizeMode, scaleType) = when (contentFit.lowercase()) {
            "cover" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM to ImageView.ScaleType.CENTER_CROP
            "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL to ImageView.ScaleType.FIT_XY
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT to ImageView.ScaleType.FIT_CENTER
        }
        playerView.resizeMode = resizeMode
        nvcRenderLayer.scaleType = scaleType
    }

    fun setSubtitleTextSize(sp: Float) {
        subtitleView?.setFixedTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, sp)
    }
}
