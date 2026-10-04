package com.infinity.mediaplayer.codec

data class NvcTelemetry(
    val isAvailable: Boolean = false,
    val isNnapiActive: Boolean = false,
    val instantFps: Float = 0.0f,
    val avgFps: Float = 0.0f,
    val bitrateKbps: Int = 0,
    val avgInferenceLatencyMs: Float = 0.0f,
    val concealedFrames: Long = 0L,
    val activeFrames: Long = 0L,
    val executionProvider: String = "CPU"
)
