package com.infinity.mediaplayer.expo

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InfinityMediaPlayerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("InfinityMediaPlayer")

        View(InfinityMediaPlayerView::class) {
            Events(
                "onLoad",
                "onTracksChange",
                "onProgress",
                "onBuffering",
                "onPlaying",
                "onPaused",
                "onEnd",
                "onError",
                "onAudioTelemetry",
                "onNvcTelemetry",
                "onLiveRecovered"
            )

            Prop("source") { view: InfinityMediaPlayerView, source: Map<String, Any?>? ->
                view.setSource(source)
            }

            Prop("paused") { view: InfinityMediaPlayerView, paused: Boolean ->
                view.setPaused(paused)
            }

            Prop("rate") { view: InfinityMediaPlayerView, rate: Float ->
                view.setPlaybackRateProp(rate)
            }

            Prop("volume") { view: InfinityMediaPlayerView, volume: Float ->
                view.setVolumeProp(volume)
            }

            Prop("contentFit") { view: InfinityMediaPlayerView, fit: String ->
                view.setContentFitProp(fit)
            }

            Prop("audioOutputMode") { view: InfinityMediaPlayerView, mode: String ->
                view.setAudioOutputModeProp(mode)
            }

            Prop("enableNvcConcealment") { view: InfinityMediaPlayerView, enable: Boolean ->
                view.setEnableNvcConcealmentProp(enable)
            }

            Prop("bufferOptions") { view: InfinityMediaPlayerView, options: Map<String, Any?>? ->
                view.setBufferOptionsProp(options)
            }

            Prop("selectedAudioTrack") { view: InfinityMediaPlayerView, track: String? ->
                view.setSelectedAudioTrackProp(track)
            }

            Prop("selectedSubtitleTrack") { view: InfinityMediaPlayerView, track: String? ->
                view.setSelectedSubtitleTrackProp(track)
            }

            Prop("selectedVideoTrack") { view: InfinityMediaPlayerView, track: String? ->
                view.setSelectedVideoTrackProp(track)
            }

            AsyncFunction("play") { view: InfinityMediaPlayerView ->
                view.play()
            }

            AsyncFunction("pause") { view: InfinityMediaPlayerView ->
                view.pause()
            }

            AsyncFunction("seekTo") { view: InfinityMediaPlayerView, positionMs: Long ->
                view.seekTo(positionMs)
            }

            AsyncFunction("seekBy") { view: InfinityMediaPlayerView, deltaSeconds: Long ->
                view.seekBy(deltaSeconds)
            }

            AsyncFunction("selectAudioTrack") { view: InfinityMediaPlayerView, trackId: String ->
                view.selectAudioTrack(trackId)
            }

            AsyncFunction("selectSubtitleTrack") { view: InfinityMediaPlayerView, trackId: String ->
                view.selectSubtitleTrack(trackId)
            }

            AsyncFunction("selectVideoTrack") { view: InfinityMediaPlayerView, trackId: String ->
                view.selectVideoTrack(trackId)
            }

            AsyncFunction("reloadSource") { view: InfinityMediaPlayerView ->
                view.reloadSource()
            }
        }
    }
}
