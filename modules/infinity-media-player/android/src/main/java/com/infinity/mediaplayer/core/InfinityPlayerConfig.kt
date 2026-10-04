package com.infinity.mediaplayer.core

import com.infinity.mediaplayer.audio.AudioOutputMode

data class InfinityPlayerConfig(
    val minBufferMs: Long = 12000L,
    val maxBufferMs: Long = 15000L,
    val bufferForPlaybackMs: Long = 1500L,
    val bufferForPlaybackAfterRebufferMs: Long = 2500L,
    val enableNvcConcealment: Boolean = true,
    val audioOutputMode: AudioOutputMode = AudioOutputMode.AUTO,
    val preferredAudioLanguages: List<String> = listOf("hi", "en"),
    val preferredSubtitleLanguages: List<String> = listOf("en", "hi"),
    val lowLatencyMpegTs: Boolean = true,
    val reconnectTimeoutMs: Long = 15000L
) {
    class Builder {
        private var minBufferMs: Long = 12000L
        private var maxBufferMs: Long = 15000L
        private var bufferForPlaybackMs: Long = 1500L
        private var bufferForPlaybackAfterRebufferMs: Long = 2500L
        private var enableNvcConcealment: Boolean = true
        private var audioOutputMode: AudioOutputMode = AudioOutputMode.AUTO
        private var preferredAudioLanguages: List<String> = listOf("hi", "en")
        private var preferredSubtitleLanguages: List<String> = listOf("en", "hi")
        private var lowLatencyMpegTs: Boolean = true
        private var reconnectTimeoutMs: Long = 15000L

        fun setBufferHysteresis(minMs: Long, maxMs: Long) = apply {
            this.minBufferMs = minMs
            this.maxBufferMs = maxMs
        }

        fun setBufferForPlayback(playbackMs: Long, rebufferMs: Long) = apply {
            this.bufferForPlaybackMs = playbackMs
            this.bufferForPlaybackAfterRebufferMs = rebufferMs
        }

        fun setEnableNvcConcealment(enable: Boolean) = apply {
            this.enableNvcConcealment = enable
        }

        fun setAudioOutputMode(mode: AudioOutputMode) = apply {
            this.audioOutputMode = mode
        }

        fun setPreferredAudioLanguages(langs: List<String>) = apply {
            this.preferredAudioLanguages = langs
        }

        fun setPreferredSubtitleLanguages(langs: List<String>) = apply {
            this.preferredSubtitleLanguages = langs
        }

        fun setLowLatencyMpegTs(enable: Boolean) = apply {
            this.lowLatencyMpegTs = enable
        }

        fun setReconnectTimeoutMs(timeoutMs: Long) = apply {
            this.reconnectTimeoutMs = timeoutMs
        }

        fun build() = InfinityPlayerConfig(
            minBufferMs,
            maxBufferMs,
            bufferForPlaybackMs,
            bufferForPlaybackAfterRebufferMs,
            enableNvcConcealment,
            audioOutputMode,
            preferredAudioLanguages,
            preferredSubtitleLanguages,
            lowLatencyMpegTs,
            reconnectTimeoutMs
        )
    }
}
