package com.infinity.mediaplayer.audio

data class InfinityAudioTrack(
    val id: String,
    val language: String?,
    val label: String?,
    val mimeType: String?,
    val codec: String?,
    val channelCount: Int,
    val sampleRate: Int,
    val bitrate: Int?,
    val isDefault: Boolean = false,
    val isForced: Boolean = false,
    val isSelected: Boolean = false
) {
    val displayTitle: String
        get() {
            if (!label.isNullOrBlank()) return label
            val langUpper = language?.uppercase() ?: "UND"
            val channelStr = if (channelCount >= 6) "5.1" else if (channelCount == 2) "Stereo" else "${channelCount}ch"
            val codecStr = when {
                mimeType?.contains("ac3") == true -> "Dolby AC-3"
                mimeType?.contains("eac3") == true -> "Dolby Digital Plus"
                mimeType?.contains("mp4a") == true || mimeType?.contains("aac") == true -> "AAC"
                mimeType?.contains("mpeg") == true -> "MP3"
                else -> mimeType ?: "Audio"
            }
            return "$langUpper ($codecStr $channelStr)"
        }
}
