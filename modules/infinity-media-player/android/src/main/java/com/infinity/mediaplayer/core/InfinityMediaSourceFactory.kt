package com.infinity.mediaplayer.core

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.extractor.ts.TsExtractor
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

@OptIn(UnstableApi::class)
object InfinityMediaSourceFactory {

    private val sharedClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun create(
        context: Context,
        headers: Map<String, String> = emptyMap(),
        config: InfinityPlayerConfig = InfinityPlayerConfig()
    ): MediaSource.Factory {
        val httpDataSourceFactory = OkHttpDataSource.Factory(sharedClient).apply {
            if (headers.isNotEmpty()) {
                setDefaultRequestProperties(headers)
            }
        }

        val baseDataSourceFactory = DefaultDataSource.Factory(context, httpDataSourceFactory)

        val extractorsFactory = DefaultExtractorsFactory().apply {
            if (config.lowLatencyMpegTs) {
                setTsExtractorFlags(
                    DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
                    DefaultTsPayloadReaderFactory.FLAG_IGNORE_SPLICE_INFO_STREAM or
                    DefaultTsPayloadReaderFactory.FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS
                )
                setTsExtractorMode(TsExtractor.MODE_SINGLE_PMT)
                setTsExtractorTimestampSearchBytes(112800)
            }
        }

        return DefaultMediaSourceFactory(context, extractorsFactory)
            .setDataSourceFactory(baseDataSourceFactory)
    }

    fun evictConnectionPool() {
        try {
            sharedClient.connectionPool.evictAll()
        } catch (_: Throwable) {}
    }
}
