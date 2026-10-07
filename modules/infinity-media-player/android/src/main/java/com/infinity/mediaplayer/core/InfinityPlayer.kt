package com.infinity.mediaplayer.core

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.video.VideoRendererEventListener
import com.infinity.mediaplayer.audio.AudioSafetyController
import com.infinity.mediaplayer.audio.AudioTelemetry
import com.infinity.mediaplayer.audio.InfinityAudioTrack
import com.infinity.mediaplayer.codec.NvcNeuralConcealer
import com.infinity.mediaplayer.codec.NvcTelemetry
import com.infinity.mediaplayer.subtitle.InfinitySubtitleTrack
import com.infinity.mediaplayer.video.InfinityVideoTrack

@OptIn(UnstableApi::class)
class InfinityPlayer(
    val context: Context,
    val config: InfinityPlayerConfig = InfinityPlayerConfig()
) {
    companion object {
        private const val TAG = "InfinityPlayer"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<InfinityPlayerListener>()

    // Subsystems
    val neuralConcealer: NvcNeuralConcealer? = if (config.enableNvcConcealment) {
        NvcNeuralConcealer(context)
    } else null

    val audioSafetyController = AudioSafetyController(context)

    // Track internal mapping: ID -> Pair(TrackGroup, Index)
    private val audioFormatMap = mutableMapOf<String, Pair<TrackGroup, Int>>()
    private val subtitleFormatMap = mutableMapOf<String, Pair<TrackGroup, Int>>()
    private val videoFormatMap = mutableMapOf<String, Pair<TrackGroup, Int>>()

    private val currentAudioTracks = mutableListOf<InfinityAudioTrack>()
    private val currentSubtitleTracks = mutableListOf<InfinitySubtitleTrack>()
    private val currentVideoTracks = mutableListOf<InfinityVideoTrack>()

    private var activeAudioTrack: InfinityAudioTrack? = null
    private var activeSubtitleTrack: InfinitySubtitleTrack? = null
    private var activeVideoTrack: InfinityVideoTrack? = null

    // Track Selector with safe defaults
    val trackSelector = DefaultTrackSelector(context).apply {
        parameters = buildUponParameters()
            .setPreferredAudioMimeTypes(MimeTypes.AUDIO_AAC, MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_OPUS)
            .setPreferredAudioLanguages(*config.preferredAudioLanguages.toTypedArray())
            .setPreferredTextLanguages(*config.preferredSubtitleLanguages.toTypedArray())
            .setConstrainAudioChannelCountToDeviceCapabilities(true)
            .setExceedRendererCapabilitiesIfNecessary(true)
            .setExceedVideoConstraintsIfNecessary(true)
            .build()
    }

    // Custom RenderersFactory with Hardware MediaCodec and Safe PCM AudioSink
    private val renderersFactory = object : DefaultRenderersFactory(context) {
        override fun buildVideoRenderers(
            context: Context,
            extensionRendererMode: Int,
            mediaCodecSelector: MediaCodecSelector,
            enableDecoderFallback: Boolean,
            eventHandler: Handler,
            eventListener: VideoRendererEventListener,
            allowedVideoJoiningTimeMs: Long,
            out: java.util.ArrayList<Renderer>
        ) {
            val interceptedVideoListener = object : VideoRendererEventListener {
                override fun onVideoEnabled(counters: androidx.media3.exoplayer.DecoderCounters) =
                    eventListener.onVideoEnabled(counters)
                override fun onVideoDecoderInitialized(decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) =
                    eventListener.onVideoDecoderInitialized(decoderName, initializedTimestampMs, initializationDurationMs)
                override fun onVideoInputFormatChanged(
                    format: Format,
                    decoderReuseEvaluation: androidx.media3.exoplayer.DecoderReuseEvaluation?
                ) = eventListener.onVideoInputFormatChanged(format, decoderReuseEvaluation)
                override fun onDroppedFrames(count: Int, elapsedMs: Long) {
                    // Forward directly to original Media3 listener without duplicate NVC triggering;
                    // AnalyticsListener and VideoFrameMetadataListener serve as authoritative sources.
                    eventListener.onDroppedFrames(count, elapsedMs)
                }
                override fun onVideoFrameProcessingOffset(totalProcessingOffsetUs: Long, frameCount: Int) =
                    eventListener.onVideoFrameProcessingOffset(totalProcessingOffsetUs, frameCount)
                override fun onRenderedFirstFrame(output: Any, renderTimeMs: Long) =
                    eventListener.onRenderedFirstFrame(output, renderTimeMs)
                override fun onVideoDecoderReleased(decoderName: String) =
                    eventListener.onVideoDecoderReleased(decoderName)
                override fun onVideoDisabled(counters: androidx.media3.exoplayer.DecoderCounters) =
                    eventListener.onVideoDisabled(counters)
                override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) =
                    eventListener.onVideoSizeChanged(videoSize)
            }

            super.buildVideoRenderers(
                context,
                EXTENSION_RENDERER_MODE_OFF,
                mediaCodecSelector,
                enableDecoderFallback,
                eventHandler,
                interceptedVideoListener,
                maxOf(allowedVideoJoiningTimeMs, 10000L),
                out
            )
        }

        override fun buildAudioSink(
            context: Context,
            enableFloatOutput: Boolean,
            enableAudioTrackPlaybackParameters: Boolean
        ): AudioSink? {
            return audioSafetyController.buildAudioSink(config.audioOutputMode)
        }

        override fun buildAudioRenderers(
            context: Context,
            extensionRendererMode: Int,
            mediaCodecSelector: MediaCodecSelector,
            enableDecoderFallback: Boolean,
            audioSink: AudioSink,
            eventHandler: Handler,
            eventListener: AudioRendererEventListener,
            out: java.util.ArrayList<Renderer>
        ) {
            try {
                out.add(androidx.media3.decoder.ffmpeg.FfmpegAudioRenderer(eventHandler, eventListener, audioSink))
                Log.i(TAG, "Explicitly loaded FfmpegAudioRenderer for software AC3/EAC3/DTS decoding.")
            } catch (t: Throwable) {
                Log.w(TAG, "FFmpeg audio extension could not be loaded: ${t.message}")
            }

            super.buildAudioRenderers(
                context,
                extensionRendererMode,
                mediaCodecSelector,
                enableDecoderFallback,
                audioSink,
                eventHandler,
                eventListener,
                out
            )
        }
    }
        .forceDisableMediaCodecAsynchronousQueueing()
        .setEnableDecoderFallback(true)
        .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)

    // LoadControl with anti-stall hysteresis
    val loadControl = InfinityLoadControl.create(config)

    // Underlying ExoPlayer instance
    val exoPlayer: ExoPlayer = ExoPlayer.Builder(context, renderersFactory)
        .setTrackSelector(trackSelector)
        .setLoadControl(loadControl)
        .setLooper(context.mainLooper)
        .build()

    private var currentUrl: String? = null
    private var isLiveStream: Boolean = false
    private var telemetryRunnable: Runnable? = null
    private var lastPresentationTimeUs: Long = 0L

    // Audio Telemetry fields
    private var activeAudioCodec: String? = null
    private var activeAudioSampleRate: Int = 0
    private var activeAudioChannels: Int = 0
    private var activeAudioDecoderName: String? = null
    private var measuredAudioLatencyMs: Long = 25L

    init {
        setupPlayerListener()
        setupVideoFrameMetadataListener()
        startTelemetryLoop()
    }

    private fun handleFrameLoss(count: Int, ptsUs: Long = 0L, gapUs: Long = 0L) {
        if (config.enableNvcConcealment && neuralConcealer != null) {
            val provider = neuralConcealer.getExecutionProvider()
            Log.i(TAG, "[NVC] Reconstruction triggered: Provider=$provider, count=$count, PTS=$ptsUs")
            val bitmap = neuralConcealer.reconstructDroppedFrame()
            if (bitmap != null) {
                Log.i(TAG, "[NVC] Frame reconstructed: ${bitmap.width}x${bitmap.height} -> Submitting to render layer")
                mainHandler.post {
                    listeners.forEach { it.onConcealedFrameRendered(bitmap) }
                }
            } else {
                neuralConcealer.recordFrameFailed()
            }
        }
    }

    fun resetDeadlineBaseline(reason: String = "Manual reset") {
        lastPresentationTimeUs = -1L
        neuralConcealer?.recordTimelineDiscontinuity()
        Log.i(TAG, "[NVC] Reset deadline baseline ($reason)")
    }

    /**
     * Updates NVC base latent directly from decoded RGB pixel buffers (v1.4.0).
     */
    fun updateLatentFromPixels(pixels: IntArray, width: Int, height: Int) {
        neuralConcealer?.updateBaseLatentFromPixels(pixels, width, height)
    }

    /**
     * Updates NVC base latent directly from decoded Bitmap (v1.4.0).
     */
    fun updateLatentFromBitmap(bitmap: android.graphics.Bitmap) {
        neuralConcealer?.updateBaseLatentFromBitmap(bitmap)
    }

    private fun setupVideoFrameMetadataListener() {
        exoPlayer.setVideoFrameMetadataListener { presentationTimeUs, _, format, _ ->
            val bitrateKbps = if (format.bitrate > 0) format.bitrate / 1000 else 0
            neuralConcealer?.recordRenderedFrame(bitrateKbps)
            neuralConcealer?.updateBaseLatentFromFrame(
                ptsUs = presentationTimeUs,
                width = format.width,
                height = format.height,
                bitrateKbps = bitrateKbps
            )
            val expectedDurationUs = if (format.frameRate > 0) (1_000_000f / format.frameRate).toLong() else 33_333L
            if (lastPresentationTimeUs > 0) {
                val gapUs = presentationTimeUs - lastPresentationTimeUs

                // Huge discontinuity (> 500ms or backward jump) indicates seek, stream leap, PCR rollover, or container discontinuity
                if (gapUs < 0 || gapUs > 500_000L) {
                    neuralConcealer?.recordTimelineDiscontinuity()
                    Log.i(TAG, "[NVC] Timeline discontinuity detected: gapUs=$gapUs (resetting PTS baseline without triggering NVC)")
                    lastPresentationTimeUs = presentationTimeUs
                    return@setVideoFrameMetadataListener
                }

                if (gapUs > (expectedDurationUs * 1.8f).toLong()) {
                    val estimatedDrops = ((gapUs / expectedDurationUs) - 1).coerceIn(1L, 10L)
                    neuralConcealer?.recordDroppedFrames(estimatedDrops)
                    neuralConcealer?.recordMissedDeadline(estimatedDrops)
                    Log.i(TAG, "[NVC] Frame deadline missed: PTS=$presentationTimeUs, expectedDurationUs=$expectedDurationUs, gapUs=$gapUs (estimated drops=$estimatedDrops)")
                    handleFrameLoss(estimatedDrops.toInt(), presentationTimeUs, gapUs)
                }
            }
            lastPresentationTimeUs = presentationTimeUs
        }
    }

    private fun setupPlayerListener() {
        exoPlayer.addListener(object : Player.Listener {
            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int
            ) {
                resetDeadlineBaseline("onPositionDiscontinuity(reason=$reason)")
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                val isPlaying = exoPlayer.isPlaying
                val isBuffering = playbackState == Player.STATE_BUFFERING
                listeners.forEach { it.onPlaybackStateChanged(isPlaying, isBuffering) }

                if (isBuffering) {
                    neuralConcealer?.recordRebuffer()
                    // Rebuffering is a network starvation state, not a dropped video frame.
                    // Do not invoke NVC here; allow presentation timeline detector to handle frame loss upon resume.
                }

                if (playbackState == Player.STATE_ENDED && isLiveStream) {
                    Log.w(TAG, "Live network stream ended (input EOS). Triggering recovery.")
                    recoverLiveStream()
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                listeners.forEach { it.onPlaybackStateChanged(isPlaying, exoPlayer.playbackState == Player.STATE_BUFFERING) }
            }

            override fun onTracksChanged(tracks: Tracks) {
                processTrackChanges(tracks)
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                Log.e(TAG, "Playback error: ${error.message}", error)
                val msg = error.message ?: ""
                val isAudioError = error.errorCodeName.contains("AUDIO", ignoreCase = true) ||
                    msg.contains("MediaCodecAudioRenderer", ignoreCase = true) ||
                    msg.contains("audio/", ignoreCase = true) ||
                    msg.contains("audio/eac3", ignoreCase = true) ||
                    msg.contains("audio/ac3", ignoreCase = true)

                if (isAudioError) {
                    audioSafetyController.recordAcdbError()

                    val currentId = activeAudioTrack?.id
                    val fallbackTrack = currentAudioTracks.firstOrNull {
                        it.id != currentId &&
                        (it.mimeType?.contains("aac", ignoreCase = true) == true ||
                         it.mimeType?.contains("mpeg", ignoreCase = true) == true ||
                         it.codec?.contains("mp4a", ignoreCase = true) == true)
                    }

                    if (fallbackTrack != null) {
                        Log.w(TAG, "Audio codec error on track $currentId. Auto-falling back to track ${fallbackTrack.id}")
                        selectAudioTrack(fallbackTrack.id)
                        return
                    }

                    Log.w(TAG, "Hardware audio decoder unavailable on device. Disabling audio track to maintain uninterrupted video rendering.")
                    selectAudioTrack("-1")
                    return
                }

                listeners.forEach { it.onError(error) }
            }
        })

        exoPlayer.addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
            override fun onDroppedVideoFrames(
                eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                droppedFrames: Int,
                elapsedMs: Long
            ) {
                if (config.enableNvcConcealment && droppedFrames > 0) {
                    // Authoritative telemetry source for renderer-reported dropped frames
                    neuralConcealer?.recordDroppedFrames(droppedFrames.toLong())
                }
            }

            override fun onAudioPositionAdvancing(
                eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                playoutStartSystemTimeMs: Long
            ) {
                val now = android.os.SystemClock.elapsedRealtime()
                val latency = (now - playoutStartSystemTimeMs).coerceAtLeast(0L)
                if (latency in 1..500) {
                    measuredAudioLatencyMs = latency
                }
            }

            override fun onAudioUnderrun(
                eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                bufferSize: Int,
                bufferSizeMs: Long,
                elapsedSinceLastFeedMs: Long
            ) {
                audioSafetyController.recordUnderrun()
            }
        })
    }

    private fun processTrackChanges(tracks: Tracks) {
        audioFormatMap.clear()
        subtitleFormatMap.clear()
        videoFormatMap.clear()
        currentAudioTracks.clear()
        currentSubtitleTracks.clear()
        currentVideoTracks.clear()

        var selectedAudio: InfinityAudioTrack? = null
        var selectedSubtitle: InfinitySubtitleTrack? = null
        var selectedVideo: InfinityVideoTrack? = null

        for (group in tracks.groups) {
            val mediaTrackGroup = group.mediaTrackGroup
            val trackType = group.type

            for (i in 0 until group.length) {
                val format: Format = group.getTrackFormat(i)
                val isSelected = group.isTrackSelected(i)

                if (trackType == C.TRACK_TYPE_AUDIO) {
                    val trackId = format.id ?: "${format.sampleMimeType}_${format.channelCount}_${format.sampleRate}_$i"
                    audioFormatMap[trackId] = mediaTrackGroup to i

                    val isTrackSupported = group.isTrackSupported(i)
                    val audioTrack = InfinityAudioTrack(
                        id = trackId,
                        language = format.language,
                        label = format.label,
                        mimeType = format.sampleMimeType,
                        codec = format.codecs,
                        channelCount = format.channelCount,
                        sampleRate = format.sampleRate,
                        bitrate = if (format.bitrate != Format.NO_VALUE) format.bitrate else null,
                        isDefault = (format.selectionFlags and C.SELECTION_FLAG_DEFAULT) != 0,
                        isForced = (format.selectionFlags and C.SELECTION_FLAG_FORCED) != 0,
                        isSelected = isSelected,
                        isSupported = isTrackSupported
                    )
                    currentAudioTracks.add(audioTrack)
                    if (isSelected) {
                        selectedAudio = audioTrack
                        activeAudioCodec = format.sampleMimeType
                        activeAudioSampleRate = format.sampleRate
                        activeAudioChannels = format.channelCount
                        activeAudioDecoderName = if (audioSafetyController.resolveEffectiveMode(config.audioOutputMode) == com.infinity.mediaplayer.audio.AudioOutputMode.STEREO_PCM) {
                            "MediaCodec (Stereo PCM Safe)"
                        } else {
                            "MediaCodec (${format.sampleMimeType})"
                        }
                    }
                } else if (trackType == C.TRACK_TYPE_TEXT) {
                    val subId = format.id ?: "subtitle_${format.language}_$i"
                    subtitleFormatMap[subId] = mediaTrackGroup to i

                    val subTrack = InfinitySubtitleTrack(
                        id = subId,
                        language = format.language,
                        label = format.label,
                        mimeType = format.sampleMimeType,
                        isForced = (format.selectionFlags and C.SELECTION_FLAG_FORCED) != 0,
                        isDefault = (format.selectionFlags and C.SELECTION_FLAG_DEFAULT) != 0,
                        isClosedCaption = (format.roleFlags and C.ROLE_FLAG_CAPTION) != 0,
                        isSelected = isSelected
                    )
                    currentSubtitleTracks.add(subTrack)
                    if (isSelected) {
                        selectedSubtitle = subTrack
                    }
                } else if (trackType == C.TRACK_TYPE_VIDEO) {
                    val vidId = format.id ?: "${format.width}x${format.height}_${format.bitrate}_$i"
                    videoFormatMap[vidId] = mediaTrackGroup to i

                    val videoTrack = InfinityVideoTrack(
                        id = vidId,
                        width = if (format.width != Format.NO_VALUE) format.width else 0,
                        height = if (format.height != Format.NO_VALUE) format.height else 0,
                        bitrate = if (format.bitrate != Format.NO_VALUE) format.bitrate else null,
                        codec = format.codecs,
                        isSelected = isSelected
                    )
                    currentVideoTracks.add(videoTrack)
                    if (isSelected) {
                        selectedVideo = videoTrack
                    }
                }
            }
        }

        activeAudioTrack = selectedAudio
        activeSubtitleTrack = selectedSubtitle
        activeVideoTrack = selectedVideo

        listeners.forEach {
            it.onAudioTracksAvailable(currentAudioTracks.toList(), activeAudioTrack)
            it.onSubtitleTracksAvailable(currentSubtitleTracks.toList(), activeSubtitleTrack)
            it.onVideoTracksAvailable(currentVideoTracks.toList(), activeVideoTrack)
        }
    }

    // ── First-Class Audio APIs ────────────────────────────────────────────────

    fun getAudioTracks(): List<InfinityAudioTrack> = currentAudioTracks.toList()

    fun getSelectedAudioTrack(): InfinityAudioTrack? = activeAudioTrack

    /**
     * Seamlessly switches audio track without resetting video rendering or re-buffering source.
     */
    fun selectAudioTrack(trackId: String): Boolean {
        if (trackId == "-1" || trackId == "disabled") {
            val newParams = exoPlayer.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)
                .build()
            exoPlayer.trackSelectionParameters = newParams
            activeAudioTrack = null
            Log.i(TAG, "Audio track disabled")
            if (exoPlayer.playerError != null) {
                exoPlayer.prepare()
            }
            return true
        }
        val target = audioFormatMap[trackId] ?: return false
        val newParams = exoPlayer.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .addOverride(TrackSelectionOverride(target.first, target.second))
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
            .build()
        exoPlayer.trackSelectionParameters = newParams
        Log.i(TAG, "Switched to audio track: $trackId")
        if (exoPlayer.playerError != null) {
            exoPlayer.prepare()
        }
        return true
    }

    // ── First-Class Subtitle APIs ─────────────────────────────────────────────

    fun getSubtitleTracks(): List<InfinitySubtitleTrack> = currentSubtitleTracks.toList()

    fun getSelectedSubtitleTrack(): InfinitySubtitleTrack? = activeSubtitleTrack

    fun selectSubtitleTrack(trackId: String): Boolean {
        if (trackId == "-1" || trackId == "disabled") {
            disableSubtitles()
            return true
        }
        val target = subtitleFormatMap[trackId] ?: return false
        val newParams = exoPlayer.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .addOverride(TrackSelectionOverride(target.first, target.second))
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .build()
        exoPlayer.trackSelectionParameters = newParams
        Log.i(TAG, "Selected subtitle track: $trackId")
        if (exoPlayer.playerError != null) {
            exoPlayer.prepare()
        }
        return true
    }

    fun disableSubtitles() {
        val newParams = exoPlayer.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            .build()
        exoPlayer.trackSelectionParameters = newParams
        activeSubtitleTrack = null
        Log.i(TAG, "Subtitles disabled.")
        if (exoPlayer.playerError != null) {
            exoPlayer.prepare()
        }
    }

    // ── First-Class Video APIs ────────────────────────────────────────────────

    fun getVideoTracks(): List<InfinityVideoTrack> = currentVideoTracks.toList()

    fun getSelectedVideoTrack(): InfinityVideoTrack? = activeVideoTrack

    fun selectVideoTrack(trackId: String): Boolean {
        if (trackId == "auto" || trackId.isEmpty() || trackId == "-1") {
            val newParams = exoPlayer.trackSelectionParameters.buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false)
                .build()
            exoPlayer.trackSelectionParameters = newParams
            Log.i(TAG, "Video track set to auto")
            return true
        }
        val target = videoFormatMap[trackId] ?: return false
        val newParams = exoPlayer.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .addOverride(TrackSelectionOverride(target.first, target.second))
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, false)
            .build()
        exoPlayer.trackSelectionParameters = newParams
        Log.i(TAG, "Selected video track: $trackId")
        return true
    }

    // ── Playback Rate & Volume Controls ──────────────────────────────────────

    fun setPlaybackRate(rate: Float) {
        try {
            exoPlayer.playbackParameters = PlaybackParameters(rate)
        } catch (e: Exception) {
            Log.w(TAG, "Error setting playback rate", e)
        }
    }

    fun setVolume(volume: Float) {
        try {
            exoPlayer.volume = volume.coerceIn(0f, 1f)
        } catch (e: Exception) {
            Log.w(TAG, "Error setting volume", e)
        }
    }

    val isPlaying: Boolean
        get() = exoPlayer.isPlaying

    // ── Telemetry Loop ────────────────────────────────────────────────────────

    private fun startTelemetryLoop() {
        telemetryRunnable = object : Runnable {
            override fun run() {
                // NVC Video Telemetry
                neuralConcealer?.let { concealer ->
                    val streamFps = exoPlayer.videoFormat?.frameRate
                    if (exoPlayer.isPlaying) {
                        val activeFps = if (streamFps != null && streamFps > 0) streamFps else 30.0f
                        concealer.updateFps(activeFps)
                    } else {
                        concealer.updateFps(0.0f)
                    }
                    val currentBitrate = exoPlayer.videoFormat?.bitrate?.let { if (it > 0) it / 1000 else 0 } ?: 0
                    val currentPos = exoPlayer.currentPosition
                    val bufferedPos = exoPlayer.bufferedPosition
                    val bufferHealthSec = maxOf(0.0f, (bufferedPos - currentPos) / 1000.0f)
                    val telemetry = concealer.getTelemetry(currentBitrate, bufferHealthSec)
                    listeners.forEach { it.onNvcTelemetryUpdated(telemetry) }
                }

                // Audio Telemetry
                val audioTelem = AudioTelemetry(
                    codec = activeAudioCodec,
                    sampleRate = activeAudioSampleRate,
                    channels = activeAudioChannels,
                    outputMode = audioSafetyController.resolveEffectiveMode(config.audioOutputMode),
                    decoderName = activeAudioDecoderName,
                    underruns = audioSafetyController.underrunCount,
                    droppedAudioFrames = 0L,
                    acdbErrorCount = audioSafetyController.acdbErrorCount,
                    audioLatencyMs = measuredAudioLatencyMs,
                    isSafetyLayerActive = true
                )
                listeners.forEach { it.onAudioTelemetryUpdated(audioTelem) }

                mainHandler.postDelayed(this, 350)
            }
        }
        mainHandler.post(telemetryRunnable!!)
    }

    // ── Playback Controls ─────────────────────────────────────────────────────

    fun play(url: String, headers: Map<String, String> = emptyMap(), isLive: Boolean = true) {
        this.currentUrl = url
        this.isLiveStream = isLive

        val mediaSourceFactory = InfinityMediaSourceFactory.create(context, headers, config)
        val mediaItem = MediaItem.fromUri(Uri.parse(url))
        val mediaSource = mediaSourceFactory.createMediaSource(mediaItem)

        exoPlayer.setMediaSource(mediaSource)
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
    }

    fun pause() {
        exoPlayer.pause()
    }

    fun resume() {
        exoPlayer.play()
    }

    fun stop() {
        exoPlayer.stop()
    }

    fun seekTo(positionMs: Long) {
        resetDeadlineBaseline("seekTo($positionMs)")
        exoPlayer.seekTo(positionMs)
    }

    val currentPosition: Long
        get() = exoPlayer.currentPosition

    val duration: Long
        get() = exoPlayer.duration

    fun recoverLiveStream() {
        val url = currentUrl ?: return
        mainHandler.post {
            InfinityMediaSourceFactory.evictConnectionPool()
            play(url, isLive = true)
            listeners.forEach { it.onLiveStreamRecovered() }
        }
    }

    fun addListener(listener: InfinityPlayerListener) {
        listeners.add(listener)
    }

    fun removeListener(listener: InfinityPlayerListener) {
        listeners.remove(listener)
    }

    fun getNvcTelemetry(): NvcTelemetry {
        return neuralConcealer?.getTelemetry() ?: NvcTelemetry()
    }

    fun getAudioTelemetry(): AudioTelemetry {
        return AudioTelemetry(
            codec = activeAudioCodec,
            sampleRate = activeAudioSampleRate,
            channels = activeAudioChannels,
            outputMode = audioSafetyController.resolveEffectiveMode(config.audioOutputMode),
            decoderName = activeAudioDecoderName,
            underruns = audioSafetyController.underrunCount,
            acdbErrorCount = audioSafetyController.acdbErrorCount,
            audioLatencyMs = measuredAudioLatencyMs
        )
    }

    fun release() {
        telemetryRunnable?.let { mainHandler.removeCallbacks(it) }
        neuralConcealer?.release()
        exoPlayer.release()
        InfinityMediaSourceFactory.evictConnectionPool()
    }
}
