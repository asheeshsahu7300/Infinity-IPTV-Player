package com.infinity.mediaplayer.codec

import android.content.Context
import android.os.SystemClock
import android.util.Log
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max

class NvcNeuralConcealer(private val context: Context) {
    companion object {
        private const val TAG = "NvcNeuralConcealer"
        private const val MODEL_ASSET_NAME = "nvc_latent_concealer.onnx"
        private const val LATENT_DIM = 256
    }

    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var isNnapiActive: Boolean = false

    private val activeFrameCounter = AtomicLong(0)
    private val concealedFrameCounter = AtomicLong(0)
    private var totalInferenceTimeMs = 0.0
    private var inferenceRuns = 0L

    private var lastFpsTimestamp = SystemClock.elapsedRealtime()
    private var lastFrameCount = 0L
    private var currentFps = 0.0f

    init {
        initializeSession()
    }

    private fun initializeSession() {
        try {
            env = OrtEnvironment.getEnvironment()
            val modelFile = getOrCopyModelFile()
            val sessionOptions = OrtSession.SessionOptions().apply {
                try {
                    addNnapi()
                    isNnapiActive = true
                    Log.i(TAG, "NNAPI hardware acceleration enabled successfully.")
                } catch (t: Throwable) {
                    isNnapiActive = false
                    Log.w(TAG, "NNAPI not supported on this device. Falling back to multi-threaded CPU: ${t.message}")
                    val numThreads = max(2, Runtime.getRuntime().availableProcessors() / 2)
                    setIntraOpNumThreads(numThreads)
                }
            }
            session = env?.createSession(modelFile.absolutePath, sessionOptions)
            Log.i(TAG, "NVC Neural Concealer initialized successfully. NNAPI=$isNnapiActive")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NVC model: ${e.message}", e)
        }
    }

    private fun getOrCopyModelFile(): File {
        val modelFile = File(context.cacheDir, MODEL_ASSET_NAME)
        if (!modelFile.exists() || modelFile.length() == 0L) {
            context.assets.open(MODEL_ASSET_NAME).use { input ->
                FileOutputStream(modelFile).use { output ->
                    input.copyTo(output)
                }
            }
        }
        return modelFile
    }

    fun recordRenderedFrame(bitrateKbps: Int = 0) {
        val frames = activeFrameCounter.incrementAndGet()
        val now = SystemClock.elapsedRealtime()
        val elapsed = now - lastFpsTimestamp
        if (elapsed >= 500) {
            val deltaFrames = frames - lastFrameCount
            currentFps = (deltaFrames * 1000.0f) / elapsed
            lastFpsTimestamp = now
            lastFrameCount = frames
        }
    }

    fun updateFps(fps: Float) {
        currentFps = fps
        if (fps > 0) {
            activeFrameCounter.addAndGet((fps * 0.35f).toLong().coerceAtLeast(1L))
        }
    }

    fun concealDroppedFrame(previousLatent: FloatArray): FloatArray? {
        val sess = session ?: return null
        val ortEnv = env ?: return null
        val startTime = SystemClock.elapsedRealtimeNanos()

        return try {
            val shape = longArrayOf(1, LATENT_DIM.toLong())
            val buffer = FloatBuffer.wrap(previousLatent)
            OnnxTensor.createTensor(ortEnv, buffer, shape).use { tensor ->
                sess.run(mapOf("latent_prev" to tensor)).use { results ->
                    val outputTensor = results[0] as OnnxTensor
                    @Suppress("UNCHECKED_CAST")
                    val concealed = (outputTensor.value as Array<FloatArray>)[0]

                    val elapsedMs = (SystemClock.elapsedRealtimeNanos() - startTime) / 1_000_000.0
                    totalInferenceTimeMs += elapsedMs
                    inferenceRuns++
                    concealedFrameCounter.incrementAndGet()

                    concealed
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Concealment inference error: ${e.message}")
            null
        }
    }

    fun getTelemetry(currentBitrateKbps: Int = 0): NvcTelemetry {
        val avgInference = if (inferenceRuns > 0) (totalInferenceTimeMs / inferenceRuns).toFloat() else 0.0f
        return NvcTelemetry(
            isAvailable = session != null,
            isNnapiActive = isNnapiActive,
            instantFps = currentFps,
            avgFps = currentFps,
            bitrateKbps = currentBitrateKbps,
            avgInferenceLatencyMs = avgInference,
            concealedFrames = concealedFrameCounter.get(),
            activeFrames = activeFrameCounter.get(),
            executionProvider = if (isNnapiActive) "NNAPI" else "ARM-CPU"
        )
    }

    fun release() {
        try {
            session?.close()
            session = null
            env?.close()
            env = null
        } catch (e: Exception) {
            Log.w(TAG, "Error closing ONNX session: ${e.message}")
        }
    }
}
