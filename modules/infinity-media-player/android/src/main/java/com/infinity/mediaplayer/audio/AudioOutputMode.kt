package com.infinity.mediaplayer.audio

enum class AudioOutputMode {
    /**
     * Inspects device SoC, audio chipset, and output routing.
     * Automatically falls back to STEREO_PCM on Qualcomm Snapdragon / Dirac devices
     * that lack ACDB calibration for compressed bitstream topologies (0x10012d00).
     */
    AUTO,

    /**
     * Forces all audio streams (AC3, E-AC3, AAC 5.1) through a 16-bit 48kHz Stereo PCM path.
     * Completely prevents Qualcomm ADSP ACDB calibration crashes and audio packet drops.
     */
    STEREO_PCM,

    /**
     * Software-decodes audio to 5.1 or 7.1 multichannel uncompressed PCM.
     */
    MULTICHANNEL_PCM,

    /**
     * Direct bitstream passthrough (AC-3, E-AC3, DTS) via IEC61937 for HDMI AVRs and soundbars.
     */
    PASSTHROUGH
}
