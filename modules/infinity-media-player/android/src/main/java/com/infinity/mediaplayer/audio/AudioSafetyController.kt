package com.infinity.mediaplayer.audio

import android.content.Context
import android.media.AudioFormat
import android.os.Build
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink

@OptIn(UnstableApi::class)
class AudioSafetyController(private val context: Context) {
    companion object {
        private const val TAG = "AudioSafetyController"

        fun isQualcommDevice(): Boolean {
            val hardware = Build.HARDWARE.lowercase()
            val board = Build.BOARD.lowercase()
            val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL.lowercase() else ""
            return hardware.contains("qcom") || hardware.contains("qualcomm") ||
                   board.contains("msm") || board.contains("sdm") || board.contains("sm") ||
                   board.contains("bengal") || board.contains("lahaina") || board.contains("taro") ||
                   soc.contains("sm") || soc.contains("snapdragon")
        }

        fun hasDiracService(): Boolean {
            val manufacturer = Build.MANUFACTURER.lowercase()
            val brand = Build.BRAND.lowercase()
            return manufacturer.contains("oneplus") || manufacturer.contains("oppo") ||
                   manufacturer.contains("realme") || brand.contains("oneplus") ||
                   brand.contains("oppo") || brand.contains("realme")
        }
    }

    var underrunCount = 0
        private set
    var acdbErrorCount = 0
        private set

    fun recordUnderrun() {
        underrunCount++
    }

    fun recordAcdbError() {
        acdbErrorCount++
    }

    fun resolveEffectiveMode(configuredMode: AudioOutputMode): AudioOutputMode {
        return when (configuredMode) {
            AudioOutputMode.AUTO -> {
                if (isQualcommDevice() || hasDiracService()) {
                    Log.i(TAG, "Qualcomm SoC or Dirac audio detected. Selecting STEREO_PCM safety path to prevent ACDB HAL crashes.")
                    AudioOutputMode.STEREO_PCM
                } else {
                    AudioOutputMode.MULTICHANNEL_PCM
                }
            }
            else -> configuredMode
        }
    }

    fun buildAudioSink(configuredMode: AudioOutputMode): AudioSink {
        val effectiveMode = resolveEffectiveMode(configuredMode)
        val builder = DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(false)

        when (effectiveMode) {
            AudioOutputMode.STEREO_PCM -> {
                builder.setAudioCapabilities(AudioCapabilities.DEFAULT_AUDIO_CAPABILITIES)
            }
            AudioOutputMode.MULTICHANNEL_PCM -> {
                builder.setAudioCapabilities(AudioCapabilities(intArrayOf(AudioFormat.ENCODING_PCM_16BIT), 8))
            }
            AudioOutputMode.PASSTHROUGH -> {
                builder.setAudioCapabilities(AudioCapabilities.getCapabilities(context))
            }
            AudioOutputMode.AUTO -> {
                builder.setAudioCapabilities(AudioCapabilities.DEFAULT_AUDIO_CAPABILITIES)
            }
        }

        return builder.build().apply {
            setOffloadMode(AudioSink.OFFLOAD_MODE_DISABLED)
        }
    }
}
