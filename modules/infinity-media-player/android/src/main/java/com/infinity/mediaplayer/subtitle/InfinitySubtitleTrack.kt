package com.infinity.mediaplayer.subtitle

data class InfinitySubtitleTrack(
    val id: String,
    val language: String?,
    val label: String?,
    val mimeType: String?,
    val isForced: Boolean = false,
    val isDefault: Boolean = false,
    val isClosedCaption: Boolean = false,
    val isSelected: Boolean = false
) {
    val displayTitle: String
        get() {
            if (!label.isNullOrBlank()) return label
            val langUpper = language?.uppercase() ?: "UNKNOWN"
            val typeStr = when {
                isClosedCaption -> " [CC]"
                isForced -> " [Forced]"
                else -> ""
            }
            return "$langUpper$typeStr"
        }
}
