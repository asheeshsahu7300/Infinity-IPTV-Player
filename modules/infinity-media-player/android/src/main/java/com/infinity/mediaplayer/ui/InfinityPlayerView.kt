package com.infinity.mediaplayer.ui

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.AttributeSet
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
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

    // Background thread for non-blocking pixel sampling from hardware video surface
    private var samplingThread: HandlerThread? = null
    private var samplingHandler: Handler? = null
    private var samplingRunnable: Runnable? = null
    private var isSamplingActive: Boolean = false

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
        if (infinityPlayer.exoPlayer.isPlaying) {
            startPixelSampling()
        }
    }

    fun detachPlayer() {
        stopPixelSampling()
        boundPlayer?.removeListener(this)
        boundPlayer = null
        playerView.player = null
        nvcRenderLayer.visibility = View.GONE
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stopPixelSampling()
        samplingThread?.quitSafely()
        samplingThread = null
        samplingHandler = null
    }

    /**
     * Starts periodic hardware surface frame tapping for learned latent feature extraction (v1.4.0).
     */
    private fun startPixelSampling() {
        if (isSamplingActive) return
        isSamplingActive = true

        if (samplingThread == null) {
            val ht = HandlerThread("NvcFrameSampler").apply { start() }
            samplingThread = ht
            samplingHandler = Handler(ht.looper)
        }

        val runnable = object : Runnable {
            override fun run() {
                if (!isSamplingActive) return
                sampleDecodedFrame()
                samplingHandler?.postDelayed(this, 350L) // ~3 FPS non-intrusive background sampling
            }
        }
        samplingRunnable = runnable
        samplingHandler?.postDelayed(runnable, 500L)
    }

    private fun stopPixelSampling() {
        isSamplingActive = false
        samplingRunnable?.let { samplingHandler?.removeCallbacks(it) }
    }

    private fun sampleDecodedFrame() {
        val player = boundPlayer ?: return
        if (player.neuralConcealer == null) return

        try {
            val videoSurface = playerView.videoSurfaceView
            if (videoSurface is SurfaceView && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (videoSurface.holder.surface.isValid) {
                    val bitmap = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888)
                    PixelCopy.request(videoSurface, bitmap, { copyResult ->
                        if (copyResult == PixelCopy.SUCCESS) {
                            player.neuralConcealer.updateBaseLatentFromBitmap(bitmap)
                        }
                    }, samplingHandler ?: mainHandler)
                }
            } else if (videoSurface is TextureView && videoSurface.isAvailable) {
                val bitmap = videoSurface.getBitmap(128, 128)
                if (bitmap != null) {
                    player.neuralConcealer.updateBaseLatentFromBitmap(bitmap)
                }
            }
        } catch (_: Throwable) {
            // Silently ignore surface lock/sampling exceptions
        }
    }

    override fun onConcealedFrameRendered(bitmap: Bitmap) {
        mainHandler.post {
            try {
                hideRunnable?.let { mainHandler.removeCallbacks(it) }
                nvcRenderLayer.setImageBitmap(bitmap)
                nvcRenderLayer.visibility = View.VISIBLE
                boundPlayer?.neuralConcealer?.recordFrameComposed()
                android.util.Log.i("InfinityPlayerView", "[NVC] Frame composed: ${bitmap.width}x${bitmap.height} successfully rendered onto GPU surface layer")

                // Automatically clear overlay once next decoded hardware frame renders
                val runnable = Runnable {
                    nvcRenderLayer.visibility = View.GONE
                }
                hideRunnable = runnable
                mainHandler.postDelayed(runnable, 65)
            } catch (t: Throwable) {
                boundPlayer?.neuralConcealer?.recordFrameFailed()
                android.util.Log.e("InfinityPlayerView", "[NVC] Frame composition failed: ${t.message}", t)
            }
        }
    }

    override fun onPlaybackStateChanged(isPlaying: Boolean, isBuffering: Boolean) {
        if (isPlaying && !isBuffering) {
            mainHandler.post {
                nvcRenderLayer.visibility = View.GONE
            }
            startPixelSampling()
        } else {
            stopPixelSampling()
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
