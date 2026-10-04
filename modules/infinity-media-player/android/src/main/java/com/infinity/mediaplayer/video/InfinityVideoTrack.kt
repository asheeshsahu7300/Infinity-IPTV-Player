package com.infinity.mediaplayer.video

data class InfinityVideoTrack(
    val id: String,
    val width: Int,
    val height: Int,
    val bitrate: Int? = null,
    val codec: String? = null,
    val isSelected: Boolean = false
) {
    val displayTitle: String
        get() {
            return when {
                height >= 2160 || width >= 3840 -> "4K UHD"
                height >= 1440 -> "2K QHD"
                height >= 1080 -> "1080p FHD"
                height >= 720 -> "720p HD"
                height >= 480 -> "480p SD"
                height > 0 -> "${height}p"
                else -> "Auto"
            }
        }
}
