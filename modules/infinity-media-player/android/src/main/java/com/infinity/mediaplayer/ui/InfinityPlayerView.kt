package com.infinity.mediaplayer.ui

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import com.infinity.mediaplayer.core.InfinityPlayer

@OptIn(UnstableApi::class)
class InfinityPlayerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    val playerView: PlayerView = PlayerView(context).apply {
        useController = false
        setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
        setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
        setKeepContentOnPlayerReset(true)
    }

    val subtitleView: SubtitleView?
        get() = playerView.subtitleView

    init {
        addView(playerView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun attachPlayer(infinityPlayer: InfinityPlayer) {
        playerView.player = infinityPlayer.exoPlayer
    }

    fun detachPlayer() {
        playerView.player = null
    }

    fun setContentFit(contentFit: String) {
        when (contentFit.lowercase()) {
            "cover" -> playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "fill" -> playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
            else -> playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    fun setSubtitleTextSize(sp: Float) {
        subtitleView?.setFixedTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, sp)
    }
}
