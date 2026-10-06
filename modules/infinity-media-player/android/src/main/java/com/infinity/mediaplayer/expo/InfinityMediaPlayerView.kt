package com.infinity.mediaplayer.expo

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import com.infinity.mediaplayer.audio.AudioOutputMode
import com.infinity.mediaplayer.audio.AudioTelemetry
import com.infinity.mediaplayer.audio.InfinityAudioTrack
import com.infinity.mediaplayer.codec.NvcTelemetry
import com.infinity.mediaplayer.core.InfinityPlayer
import com.infinity.mediaplayer.core.InfinityPlayerConfig
import com.infinity.mediaplayer.core.InfinityPlayerListener
import com.infinity.mediaplayer.subtitle.InfinitySubtitleTrack
import com.infinity.mediaplayer.ui.InfinityPlayerView
import com.infinity.mediaplayer.video.InfinityVideoTrack
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@OptIn(UnstableApi::class)
class InfinityMediaPlayerView(
    context: Context,
    appContext: AppContext
) : ExpoView(context, appContext), InfinityPlayerListener {

    companion object {
        private const val TAG = "InfinityMediaPlayerView"
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    // Event Dispatchers
    val onLoad by EventDispatcher<Map<String, Any?>>()
    val onTracksChange by EventDispatcher<Map<String, Any?>>()
    val onProgress by EventDispatcher<Map<String, Any>>()
    val onBuffering by EventDispatcher<Map<String, Any>>()
    val onPlaying by EventDispatcher<Map<String, Any>>()
    val onPaused by EventDispatcher<Map<String, Any>>()
    val onEnd by EventDispatcher<Map<String, Any>>()
    val onError by EventDispatcher<Map<String, Any?>>()
    val onAudioTelemetry by EventDispatcher<Map<String, Any>>()
    val onNvcTelemetry by EventDispatcher<Map<String, Any>>()
    val onLiveRecovered by EventDispatcher<Map<String, Any>>()

    private val playerViewContainer = InfinityPlayerView(context)
    private var infinityPlayer: InfinityPlayer? = null

    // State cache
    private var currentUrl: String = ""
    private var currentHeaders: Map<String, String> = emptyMap()
    private var isLive: Boolean = true
    private var paused: Boolean = false
    private var volume: Float = 1.0f
    private var playbackRate: Float = 1.0f
    private var enableNvc: Boolean = true
    private var audioMode: AudioOutputMode = AudioOutputMode.AUTO

    private var minBufferMs: Long = 12000L
    private var maxBufferMs: Long = 15000L
    private var bufferForPlaybackMs: Long = 1500L
    private var bufferForPlaybackAfterRebufferMs: Long = 2500L

    private var pendingAudioTrack: String? = null
    private var pendingSubtitleTrack: String? = null
    private var pendingVideoTrack: String? = null

    private var isFirstLoad: Boolean = true
    private var progressIntervalRunnable: Runnable? = null

    init {
        addView(
            playerViewContainer,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        initPlayer()
        startProgressLoop()
    }

    private fun initPlayer() {
        infinityPlayer?.release()

        val config = InfinityPlayerConfig.Builder()
            .setEnableNvcConcealment(enableNvc)
            .setAudioOutputMode(audioMode)
            .setBufferHysteresis(minBufferMs, maxBufferMs)
            .setBufferForPlayback(bufferForPlaybackMs, bufferForPlaybackAfterRebufferMs)
            .build()

        val player = InfinityPlayer(context, config)
        player.addListener(this)
        playerViewContainer.attachPlayer(player)
        infinityPlayer = player
    }

    private fun startProgressLoop() {
        progressIntervalRunnable = object : Runnable {
            override fun run() {
                val player = infinityPlayer
                if (player != null && player.isPlaying) {
                    val pos = player.currentPosition
                    val dur = player.duration
                    onProgress(
                        mapOf(
                            "currentTimeMs" to pos,
                            "durationMs" to (if (dur > 0) dur else 0L)
                        )
                    )
                }
                mainHandler.postDelayed(this, 250)
            }
        }
        mainHandler.post(progressIntervalRunnable!!)
    }

    // ── Public Props Setters ──────────────────────────────────────────────────

    fun setSource(sourceMap: Map<String, Any?>?) {
        if (sourceMap == null) return
        val url = sourceMap["uri"] as? String ?: ""
        @Suppress("UNCHECKED_CAST")
        val headers = (sourceMap["headers"] as? Map<String, String>) ?: emptyMap()
        val live = (sourceMap["isLive"] as? Boolean) ?: true

        if (url != currentUrl || headers != currentHeaders) {
            currentUrl = url
            currentHeaders = headers
            isLive = live
            isFirstLoad = true

            if (url.isNotEmpty()) {
                infinityPlayer?.play(url, headers, live)
                if (paused) {
                    infinityPlayer?.pause()
                }
            }
        }
    }

    fun setPaused(isPaused: Boolean) {
        paused = isPaused
        if (isPaused) {
            infinityPlayer?.pause()
        } else {
            infinityPlayer?.resume()
        }
    }

    fun setPlaybackRateProp(rate: Float) {
        playbackRate = rate
        infinityPlayer?.setPlaybackRate(rate)
    }

    fun setVolumeProp(vol: Float) {
        volume = vol
        infinityPlayer?.setVolume(vol)
    }

    fun setContentFitProp(fit: String) {
        when (fit.lowercase()) {
            "cover" -> playerViewContainer.playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "fill" -> playerViewContainer.playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
            else -> playerViewContainer.playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    fun setAudioOutputModeProp(modeStr: String) {
        val mode = when (modeStr.lowercase()) {
            "stereo" -> AudioOutputMode.STEREO_PCM
            "multichannel" -> AudioOutputMode.MULTICHANNEL_PCM
            "passthrough" -> AudioOutputMode.PASSTHROUGH
            else -> AudioOutputMode.AUTO
        }
        if (mode != audioMode) {
            audioMode = mode
            if (currentUrl.isNotEmpty()) {
                reloadSource()
            }
        }
    }

    fun setEnableNvcConcealmentProp(enable: Boolean) {
        if (enable != enableNvc) {
            enableNvc = enable
            if (currentUrl.isNotEmpty()) {
                reloadSource()
            }
        }
    }

    fun setBufferOptionsProp(options: Map<String, Any?>?) {
        if (options == null) return
        minBufferMs = (options["minBufferMs"] as? Number)?.toLong() ?: minBufferMs
        maxBufferMs = (options["maxBufferMs"] as? Number)?.toLong() ?: maxBufferMs
        bufferForPlaybackMs = (options["bufferForPlaybackMs"] as? Number)?.toLong() ?: bufferForPlaybackMs
        bufferForPlaybackAfterRebufferMs = (options["bufferForPlaybackAfterRebufferMs"] as? Number)?.toLong() ?: bufferForPlaybackAfterRebufferMs
    }

    fun setSelectedAudioTrackProp(trackId: String?) {
        pendingAudioTrack = trackId
        if (trackId != null && trackId.isNotEmpty()) {
            infinityPlayer?.selectAudioTrack(trackId)
        }
    }

    fun setSelectedSubtitleTrackProp(trackId: String?) {
        pendingSubtitleTrack = trackId
        if (trackId != null && trackId.isNotEmpty()) {
            infinityPlayer?.selectSubtitleTrack(trackId)
        }
    }

    fun setSelectedVideoTrackProp(trackId: String?) {
        pendingVideoTrack = trackId
        if (trackId != null && trackId.isNotEmpty()) {
            infinityPlayer?.selectVideoTrack(trackId)
        }
    }

    // ── Imperative Commands ───────────────────────────────────────────────────

    fun play() {
        paused = false
        infinityPlayer?.resume()
    }

    fun pause() {
        paused = true
        infinityPlayer?.pause()
    }

    fun seekTo(positionMs: Long) {
        infinityPlayer?.seekTo(positionMs)
    }

    fun seekBy(deltaSeconds: Long) {
        val current = infinityPlayer?.currentPosition ?: 0L
        val target = (current + deltaSeconds * 1000L).coerceAtLeast(0L)
        infinityPlayer?.seekTo(target)
    }

    fun selectAudioTrack(trackId: String) {
        infinityPlayer?.selectAudioTrack(trackId)
    }

    fun selectSubtitleTrack(trackId: String) {
        infinityPlayer?.selectSubtitleTrack(trackId)
    }

    fun selectVideoTrack(trackId: String) {
        infinityPlayer?.selectVideoTrack(trackId)
    }

    fun reloadSource() {
        isFirstLoad = true
        initPlayer()
        if (currentUrl.isNotEmpty()) {
            infinityPlayer?.play(currentUrl, currentHeaders, isLive)
            if (paused) {
                infinityPlayer?.pause()
            }
        }
    }

    fun getPlayer(): InfinityPlayer? = infinityPlayer

    // ── InfinityPlayerListener Callbacks ──────────────────────────────────────

    override fun onPlaybackStateChanged(isPlaying: Boolean, isBuffering: Boolean) {
        onBuffering(mapOf("isBuffering" to isBuffering))
        if (isPlaying) {
            onPlaying(emptyMap<String, Any>())
        } else if (paused) {
            onPaused(emptyMap<String, Any>())
        }
    }

    override fun onAudioTracksAvailable(tracks: List<InfinityAudioTrack>, selectedTrack: InfinityAudioTrack?) {
        val mappedAudio = tracks.map { trackToMap(it) }
        val mappedSub = infinityPlayer?.getSubtitleTracks()?.map { subToMap(it) } ?: emptyList()
        val mappedVid = infinityPlayer?.getVideoTracks()?.map { vidToMap(it) } ?: emptyList()
        val currAudio = selectedTrack?.let { trackToMap(it) }

        val payload = mapOf(
            "audioTracks" to mappedAudio,
            "subtitleTracks" to mappedSub,
            "textTracks" to mappedSub,
            "videoTracks" to mappedVid,
            "currentAudioTrack" to currAudio,
            "duration" to (infinityPlayer?.duration ?: 0L)
        )

        if (isFirstLoad) {
            isFirstLoad = false
            onLoad(payload)
        } else {
            onTracksChange(payload)
        }
    }

    override fun onSubtitleTracksAvailable(tracks: List<InfinitySubtitleTrack>, selectedTrack: InfinitySubtitleTrack?) {
        val mappedAudio = infinityPlayer?.getAudioTracks()?.map { trackToMap(it) } ?: emptyList()
        val mappedSub = tracks.map { subToMap(it) }
        val mappedVid = infinityPlayer?.getVideoTracks()?.map { vidToMap(it) } ?: emptyList()

        onTracksChange(
            mapOf(
                "audioTracks" to mappedAudio,
                "subtitleTracks" to mappedSub,
                "textTracks" to mappedSub,
                "videoTracks" to mappedVid,
                "currentAudioTrack" to infinityPlayer?.getSelectedAudioTrack()?.let { trackToMap(it) }
            )
        )
    }

    override fun onVideoTracksAvailable(tracks: List<InfinityVideoTrack>, selectedTrack: InfinityVideoTrack?) {
        val mappedAudio = infinityPlayer?.getAudioTracks()?.map { trackToMap(it) } ?: emptyList()
        val mappedSub = infinityPlayer?.getSubtitleTracks()?.map { subToMap(it) } ?: emptyList()
        val mappedVid = tracks.map { vidToMap(it) }

        onTracksChange(
            mapOf(
                "audioTracks" to mappedAudio,
                "subtitleTracks" to mappedSub,
                "textTracks" to mappedSub,
                "videoTracks" to mappedVid,
                "currentAudioTrack" to infinityPlayer?.getSelectedAudioTrack()?.let { trackToMap(it) }
            )
        )
    }

    override fun onAudioTelemetryUpdated(telemetry: AudioTelemetry) {
        onAudioTelemetry(
            mapOf(
                "codec" to (telemetry.codec ?: "unknown"),
                "sampleRate" to telemetry.sampleRate,
                "channels" to telemetry.channels,
                "outputMode" to telemetry.outputMode.name,
                "decoderName" to (telemetry.decoderName ?: ""),
                "underruns" to telemetry.underruns,
                "acdbErrorCount" to telemetry.acdbErrorCount
            )
        )
    }

    override fun onNvcTelemetryUpdated(telemetry: NvcTelemetry) {
        onNvcTelemetry(
            mapOf(
                "isAvailable" to telemetry.isAvailable,
                "isNnapiActive" to telemetry.isNnapiActive,
                "instantFps" to telemetry.instantFps,
                "avgFps" to telemetry.avgFps,
                "bitrateKbps" to telemetry.bitrateKbps,
                "avgInferenceLatencyMs" to telemetry.avgInferenceLatencyMs,
                "lastInferenceLatencyMs" to telemetry.lastInferenceLatencyMs,
                "latencyP50Ms" to telemetry.latencyP50Ms,
                "latencyP95Ms" to telemetry.latencyP95Ms,
                "concealedFrames" to telemetry.concealedFrames,
                "droppedFrames" to telemetry.droppedFrames,
                "missedDeadlines" to telemetry.missedDeadlines,
                "activeFrames" to telemetry.activeFrames,
                "executionProvider" to telemetry.executionProvider,
                "cpuUsagePercent" to telemetry.cpuUsagePercent,
                "ramUsageMb" to telemetry.ramUsageMb,
                "thermalStatus" to telemetry.thermalStatus,
                "batteryLevel" to telemetry.batteryLevel,
                "bufferHealthSec" to telemetry.bufferHealthSec,
                "packetLossPercent" to telemetry.packetLossPercent,
                "rebufferCount" to telemetry.rebufferCount
            )
        )
    }

    override fun onLiveStreamRecovered() {
        onLiveRecovered(emptyMap<String, Any>())
    }

    override fun onError(error: Throwable) {
        val mappedAudio = infinityPlayer?.getAudioTracks()?.map { trackToMap(it) } ?: emptyList()
        onError(
            mapOf(
                "message" to (error.message ?: "Playback error"),
                "audioTracks" to mappedAudio
            )
        )
    }

    // ── Helper Serialization ──────────────────────────────────────────────────

    private fun trackToMap(t: InfinityAudioTrack): Map<String, Any?> {
        return mapOf(
            "id" to t.id,
            "title" to t.displayTitle,
            "name" to t.displayTitle,
            "language" to (t.language ?: ""),
            "mimeType" to (t.mimeType ?: ""),
            "codec" to (t.codec ?: ""),
            "channelCount" to t.channelCount,
            "sampleRate" to t.sampleRate,
            "bitrate" to t.bitrate,
            "isDefault" to t.isDefault,
            "isForced" to t.isForced,
            "isSelected" to t.isSelected,
            "isSupported" to t.isSupported
        )
    }

    private fun subToMap(t: InfinitySubtitleTrack): Map<String, Any?> {
        return mapOf(
            "id" to t.id,
            "title" to t.displayTitle,
            "name" to t.displayTitle,
            "language" to (t.language ?: ""),
            "mimeType" to (t.mimeType ?: ""),
            "isClosedCaption" to t.isClosedCaption,
            "isForced" to t.isForced,
            "isDefault" to t.isDefault,
            "isSelected" to t.isSelected
        )
    }

    private fun vidToMap(t: InfinityVideoTrack): Map<String, Any?> {
        return mapOf(
            "id" to t.id,
            "title" to t.displayTitle,
            "name" to t.displayTitle,
            "width" to t.width,
            "height" to t.height,
            "bitrate" to t.bitrate,
            "codec" to (t.codec ?: ""),
            "isSelected" to t.isSelected
        )
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        progressIntervalRunnable?.let { mainHandler.removeCallbacks(it) }
        infinityPlayer?.release()
        infinityPlayer = null
    }
}
