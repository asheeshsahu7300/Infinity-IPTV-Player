package com.infinity.mediaplayer.core

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl

@OptIn(UnstableApi::class)
object InfinityLoadControl {
    fun create(config: InfinityPlayerConfig): LoadControl {
        return DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                config.minBufferMs.toInt(),
                config.maxBufferMs.toInt(),
                config.bufferForPlaybackMs.toInt(),
                config.bufferForPlaybackAfterRebufferMs.toInt()
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
    }
}
