package com.infinity.mediaplayer.audio

data class AudioTelemetry(
    val codec: String? = null,
    val sampleRate: Int = 0,
    val channels: Int = 0,
    val outputMode: AudioOutputMode = AudioOutputMode.AUTO,
    val decoderName: String? = null,
    val underruns: Int = 0,
    val droppedAudioFrames: Long = 0L,
    val acdbErrorCount: Int = 0,
    val audioLatencyMs: Long = 0L,
    val isSafetyLayerActive: Boolean = true
)
