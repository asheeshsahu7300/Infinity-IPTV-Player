package com.infinity.mediaplayer.core

import com.infinity.mediaplayer.audio.AudioTelemetry
import com.infinity.mediaplayer.audio.InfinityAudioTrack
import com.infinity.mediaplayer.codec.NvcTelemetry
import com.infinity.mediaplayer.subtitle.InfinitySubtitleTrack
import com.infinity.mediaplayer.video.InfinityVideoTrack

interface InfinityPlayerListener {
    fun onPlaybackStateChanged(isPlaying: Boolean, isBuffering: Boolean) {}
    fun onNvcTelemetryUpdated(telemetry: NvcTelemetry) {}
    fun onAudioTelemetryUpdated(telemetry: AudioTelemetry) {}
    fun onLiveStreamRecovered() {}
    fun onAudioTracksAvailable(tracks: List<InfinityAudioTrack>, selectedTrack: InfinityAudioTrack?) {}
    fun onSubtitleTracksAvailable(tracks: List<InfinitySubtitleTrack>, selectedTrack: InfinitySubtitleTrack?) {}
    fun onVideoTracksAvailable(tracks: List<InfinityVideoTrack>, selectedTrack: InfinityVideoTrack?) {}
    fun onError(error: Throwable) {}
}
