package com.infinity.mediaplayer.codec

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Color
import android.os.BatteryManager
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

class NvcNeuralConcealer(private val context: Context) {
    companion object {
        private const val TAG = "NvcNeuralConcealer"
        private const val RECONSTRUCTOR_MODEL_NAME = "nvc_reconstructor_e2e.onnx"
        private const val CONCEALER_MODEL_NAME = "nvc_latent_concealer.onnx"
        private const val BASE_CHANNELS = 48
        private const val LATENT_H = 32
        private const val LATENT_W = 32
        private const val OUT_H = 128
        private const val OUT_W = 128
    }

    private var env: OrtEnvironment? = null
    private var reconstructorSession: OrtSession? = null
    private var concealerSession: OrtSession? = null
    private var isNnapiActive: Boolean = false

    // Analysis Feature Extractor (v1.4.0)
    private val featureExtractor = NvcFeatureExtractor(BASE_CHANNELS, LATENT_H, LATENT_W)
    private var isPixelLatentExtracted: Boolean = false
    private var lastLatentUpdateTimeMs: Long = 0L

    private val activeFrameCounter = AtomicLong(0)
    private val droppedFrameCounter = AtomicLong(0)
    private val concealedFrameCounter = AtomicLong(0)
    private val composedFrameCounter = AtomicLong(0)
    private val failedFrameCounter = AtomicLong(0)
    private val missedDeadlineCounter = AtomicLong(0)
    private val timelineDiscontinuityCounter = AtomicLong(0)
    private var rebufferCounter = 0

    private var totalInferenceTimeMs = 0.0
    private var lastInferenceLatencyMs = 0.0f
    private var inferenceRuns = 0L

    // Sliding window of recent inference latencies for P50 / P95 calculations
    private val latencyHistory = FloatArray(128)
    private var latencyHistoryIndex = 0
    private var latencyHistoryCount = 0

    private var lastFpsTimestamp = SystemClock.elapsedRealtime()
    private var lastFrameCount = 0L
    private var currentFps = 0.0f

    // Running temporal latent state (base representation)
    private var currentBaseLatent = FloatArray(BASE_CHANNELS * LATENT_H * LATENT_W) { 0.1f }

    // Real CPU measurement tracking
    private var lastCpuTimeMs = android.os.Process.getElapsedCpuTime()
    private var lastCpuTimestampMs = SystemClock.elapsedRealtime()
    private var realCpuUsagePercent = 0.0f

    // Reusable pixel buffer for Bitmap generation
    private val rgbPixels = IntArray(OUT_H * OUT_W)

    init {
        initializeSessions()
    }

    private fun createSessionOptions(): OrtSession.SessionOptions {
        return OrtSession.SessionOptions().apply {
            try {
                addNnapi()
                isNnapiActive = true
            } catch (t: Throwable) {
                isNnapiActive = false
                val numThreads = max(2, Runtime.getRuntime().availableProcessors() / 2)
                setIntraOpNumThreads(numThreads)
                setInterOpNumThreads(2)
            }
        }
    }

    private fun initializeSessions() {
        try {
            env = OrtEnvironment.getEnvironment()

            // 1. Primary Reconstructor Session (Synthesis Decoder)
            val recModelFile = getOrCopyModelFile(RECONSTRUCTOR_MODEL_NAME)
            val recOptions = createSessionOptions()
            reconstructorSession = env?.createSession(recModelFile.absolutePath, recOptions)

            // 2. Secondary Latent Concealer Session (Temporal Latent Predictor)
            try {
                val concModelFile = getOrCopyModelFile(CONCEALER_MODEL_NAME)
                val concOptions = createSessionOptions()
                concealerSession = env?.createSession(concModelFile.absolutePath, concOptions)
                Log.i(TAG, "NVC-Live v1.4: Latent Concealer loaded ($CONCEALER_MODEL_NAME)")
            } catch (ce: Exception) {
                Log.w(TAG, "Optional NVC Latent Concealer not loaded: ${ce.message}")
            }

            val provider = if (isNnapiActive) "NNAPI" else "ARM-CPU"
            Log.i(TAG, "==================================================")
            Log.i(TAG, "NVC-Live v1.4 Pipeline Initialized")
            Log.i(TAG, "Provider: $provider")
            Log.i(TAG, "Reconstructor: ${reconstructorSession != null}")
            Log.i(TAG, "Two-Stage Latent Predictor: ${concealerSession != null}")
            Log.i(TAG, "==================================================")

            runDeterministicVerification(reconstructorSession)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize NVC model sessions: ${e.message}", e)
        }
    }

    private fun runDeterministicVerification(sess: OrtSession?) {
        val s = sess ?: return
        val ortEnv = env ?: return
        try {
            val testBuffer = FloatArray(BASE_CHANNELS * LATENT_H * LATENT_W) { 0.5f }
            val shape = longArrayOf(1, BASE_CHANNELS.toLong(), LATENT_H.toLong(), LATENT_W.toLong())
            val tensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(testBuffer), shape)

            val t0 = SystemClock.elapsedRealtimeNanos()
            tensor.use { t ->
                s.run(mapOf("y_base" to t)).use { results ->
                    val elapsedMs = (SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000.0f
                    val outTensor = results[0] as OnnxTensor
                    @Suppress("UNCHECKED_CAST")
                    val rgbOutput = outTensor.value as Array<Array<Array<FloatArray>>>
                    val outH = rgbOutput[0][0].size
                    val outW = rgbOutput[0][0][0].size

                    var minVal = Float.MAX_VALUE
                    var maxVal = Float.MIN_VALUE
                    for (c in 0 until 3) {
                        for (r in 0 until outH) {
                            for (col in 0 until outW) {
                                val v = rgbOutput[0][c][r][col]
                                if (v < minVal) minVal = v
                                if (v > maxVal) maxVal = v
                            }
                        }
                    }
                    Log.i(TAG, "[NVC Deterministic Test] Input min=0.5, max=0.5, shape=[1,$BASE_CHANNELS,$LATENT_H,$LATENT_W]")
                    Log.i(TAG, "[NVC Deterministic Test] Output min=$minVal, max=$maxVal, shape=[1,3,$outH,$outW], time=${elapsedMs}ms")
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Deterministic verification test warning: ${t.message}")
        }
    }

    private fun getOrCopyModelFile(assetName: String): File {
        val modelFile = File(context.cacheDir, assetName)
        if (!modelFile.exists() || modelFile.length() == 0L) {
            context.assets.open(assetName).use { input ->
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
        // Maintained for caller compatibility; authoritative FPS measured by recordRenderedFrame()
    }

    fun recordDroppedFrames(count: Long) {
        if (count > 0) {
            droppedFrameCounter.addAndGet(count)
        }
    }

    fun recordMissedDeadline(count: Long) {
        if (count > 0) {
            missedDeadlineCounter.addAndGet(count)
        }
    }

    fun recordTimelineDiscontinuity() {
        timelineDiscontinuityCounter.incrementAndGet()
        featureExtractor.resetTemporalState()
    }

    fun recordFrameComposed() {
        composedFrameCounter.incrementAndGet()
    }

    fun recordFrameFailed() {
        failedFrameCounter.incrementAndGet()
    }

    fun getExecutionProvider(): String = if (isNnapiActive) "NNAPI" else "ARM-CPU"

    fun getLatencyP50(): Float {
        if (latencyHistoryCount == 0) return lastInferenceLatencyMs
        val copy = latencyHistory.copyOfRange(0, latencyHistoryCount).sortedArray()
        return copy[copy.size / 2]
    }

    fun getLatencyP95(): Float {
        if (latencyHistoryCount == 0) return lastInferenceLatencyMs
        val copy = latencyHistory.copyOfRange(0, latencyHistoryCount).sortedArray()
        val p95Index = ((copy.size - 1) * 0.95f).toInt()
        return copy[p95Index]
    }

    fun recordRebuffer() {
        rebufferCounter++
    }

    /**
     * Extracts and updates base latent from actual decoded video frame pixels (v1.4.0).
     */
    fun updateBaseLatentFromPixels(pixels: IntArray, width: Int, height: Int) {
        featureExtractor.extractLatentFromRgbPixels(pixels, width, height, currentBaseLatent)
        isPixelLatentExtracted = true
        lastLatentUpdateTimeMs = SystemClock.uptimeMillis()
    }

    /**
     * Extracts and updates base latent from decoded Bitmap (v1.4.0).
     */
    fun updateBaseLatentFromBitmap(bitmap: Bitmap) {
        featureExtractor.extractLatentFromBitmap(bitmap, currentBaseLatent)
        isPixelLatentExtracted = true
        lastLatentUpdateTimeMs = SystemClock.uptimeMillis()
    }

    /**
     * Updates stream-conditioned base latent representation based on incoming frame metadata.
     * Used as a prior when direct decoded pixel buffers are not yet available.
     */
    fun updateBaseLatentFromFrame(
        ptsUs: Long,
        width: Int,
        height: Int,
        bitrateKbps: Int
    ) {
        if (isPixelLatentExtracted) return // Prioritize real pixel features once available

        val ptsSec = ptsUs / 1_000_000.0f
        val aspectRatio = if (height > 0) width.toFloat() / height.toFloat() else 1.777f
        val bitrateEnergy = (bitrateKbps.coerceIn(500, 25000) / 25000.0f) * 0.4f + 0.1f

        var idx = 0
        for (c in 0 until BASE_CHANNELS) {
            val freqC = (c + 1) * 0.35f
            val phaseC = c * 0.25f
            val baseChannelVal = sin(ptsSec * freqC + phaseC) * 0.15f * bitrateEnergy
            for (y in 0 until LATENT_H) {
                val ny = (y.toFloat() / LATENT_H) * 2.0f - 1.0f
                for (x in 0 until LATENT_W) {
                    val nx = ((x.toFloat() / LATENT_W) * 2.0f - 1.0f) * aspectRatio
                    val spatialHarmonic = cos(nx * 1.5f + ny * 1.5f + c.toFloat()) * 0.05f
                    currentBaseLatent[idx++] = (baseChannelVal + spatialHarmonic).coerceIn(-1.0f, 1.0f)
                }
            }
        }
    }

    /**
     * Sets an explicit custom base latent tensor (e.g. from an upstream neural encoder).
     */
    fun updateBaseLatent(customLatent: FloatArray) {
        if (customLatent.size == currentBaseLatent.size) {
            System.arraycopy(customLatent, 0, currentBaseLatent, 0, currentBaseLatent.size)
            isPixelLatentExtracted = true
        }
    }

    private fun getProcessCpuUsagePercent(): Float {
        val currentCpuTime = android.os.Process.getElapsedCpuTime()
        val now = SystemClock.elapsedRealtime()
        val cpuDelta = currentCpuTime - lastCpuTimeMs
        val timeDelta = now - lastCpuTimestampMs
        if (timeDelta >= 350) {
            val numCores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
            realCpuUsagePercent = ((cpuDelta.toFloat() / (timeDelta * numCores)) * 100.0f).coerceIn(0.0f, 100.0f)
            lastCpuTimeMs = currentCpuTime
            lastCpuTimestampMs = now
        }
        return realCpuUsagePercent
    }

    /**
     * Runs Stage 1: Neural Latent Concealment / Temporal Propagation
     * Input: y_base [1, 48, 32, 32] -> Output: predicted_enhancement [1, 48, 32, 32]
     */
    private fun runLatentConcealerStage(inputLatent: FloatArray, shape: LongArray): FloatArray? {
        val s = concealerSession ?: return null
        val ortEnv = env ?: return null
        return try {
            val buffer = FloatBuffer.wrap(inputLatent)
            OnnxTensor.createTensor(ortEnv, buffer, shape).use { tensor ->
                s.run(mapOf("y_base" to tensor)).use { results ->
                    val outTensor = results[0] as OnnxTensor
                    @Suppress("UNCHECKED_CAST")
                    val outVal = outTensor.value as Array<Array<Array<FloatArray>>>
                    val channels = outVal[0].size
                    val h = outVal[0][0].size
                    val w = outVal[0][0][0].size
                    val output = FloatArray(channels * h * w)
                    var idx = 0
                    for (c in 0 until channels) {
                        for (r in 0 until h) {
                            val row = outVal[0][c][r]
                            for (col in 0 until w) {
                                output[idx++] = row[col]
                            }
                        }
                    }
                    output
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Latent concealer stage fallback: ${t.message}")
            null
        }
    }

    /**
     * Executes real end-to-end NVC neural frame reconstruction:
     * Base latent [1, 48, H, W] -> (Stage 1 Latent Predictor) -> (Stage 2 Synthesis Decoder) -> Reconstructed RGB Bitmap [128x128]
     */
    @Synchronized
    fun reconstructDroppedFrame(
        customLatent: FloatArray? = null,
        targetWidth: Int = LATENT_W,
        targetHeight: Int = LATENT_H
    ): Bitmap? {
        val sess = reconstructorSession ?: return null
        val ortEnv = env ?: return null
        val startTime = SystemClock.elapsedRealtimeNanos()

        val latentToUse = customLatent ?: currentBaseLatent
        val shape = longArrayOf(1, BASE_CHANNELS.toLong(), targetHeight.toLong(), targetWidth.toLong())

        // Stage 1: Neural Latent Propagation (if concealerSession is available and no custom latent provided)
        val stage1Latent = if (concealerSession != null && customLatent == null) {
            runLatentConcealerStage(latentToUse, shape) ?: latentToUse
        } else {
            latentToUse
        }

        // Stage 2: Synthesis Reconstruction to RGB
        return try {
            val buffer = FloatBuffer.wrap(stage1Latent)
            OnnxTensor.createTensor(ortEnv, buffer, shape).use { tensor ->
                sess.run(mapOf("y_base" to tensor)).use { results ->
                    val outputTensor = results[0] as OnnxTensor
                    @Suppress("UNCHECKED_CAST")
                    val rgbOutput = outputTensor.value as Array<Array<Array<FloatArray>>>
                    // rgbOutput shape: [1][3][OUT_H][OUT_W]
                    val redPlane = rgbOutput[0][0]
                    val greenPlane = rgbOutput[0][1]
                    val bluePlane = rgbOutput[0][2]

                    val outH = redPlane.size
                    val outW = redPlane[0].size

                    var idx = 0
                    for (r in 0 until outH) {
                        val rowR = redPlane[r]
                        val rowG = greenPlane[r]
                        val rowB = bluePlane[r]
                        for (c in 0 until outW) {
                            val red = (rowR[c].coerceIn(0.0f, 1.0f) * 255.0f).toInt()
                            val green = (rowG[c].coerceIn(0.0f, 1.0f) * 255.0f).toInt()
                            val blue = (rowB[c].coerceIn(0.0f, 1.0f) * 255.0f).toInt()
                            rgbPixels[idx++] = Color.rgb(red, green, blue)
                        }
                    }

                    val elapsedMs = (SystemClock.elapsedRealtimeNanos() - startTime) / 1_000_000.0f
                    lastInferenceLatencyMs = elapsedMs
                    totalInferenceTimeMs += elapsedMs
                    inferenceRuns++
                    concealedFrameCounter.incrementAndGet()

                    // Record into sliding window
                    val hIdx = latencyHistoryIndex % latencyHistory.size
                    latencyHistory[hIdx] = elapsedMs
                    latencyHistoryIndex++
                    if (latencyHistoryCount < latencyHistory.size) latencyHistoryCount++

                    val provider = getExecutionProvider()
                    val modeStr = if (concealerSession != null) "Two-Stage" else "Single-Stage"
                    Log.i(TAG, "[NVC] Reconstruction complete: Pipeline=$modeStr, Provider=$provider, Inference=${String.format("%.2f", elapsedMs)}ms, Output=${outW}x${outH}")

                    Bitmap.createBitmap(rgbPixels, outW, outH, Bitmap.Config.ARGB_8888)
                }
            }
        } catch (e: Exception) {
            failedFrameCounter.incrementAndGet()
            Log.w(TAG, "[NVC] Reconstruction failed: ${e.message}")
            null
        }
    }

    fun concealDroppedFrame(previousLatent: FloatArray? = null): FloatArray? {
        reconstructDroppedFrame(customLatent = previousLatent)
        return previousLatent
    }

    private fun getThermalStatusString(): String {
        return try {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            when (powerManager?.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE -> "NOMINAL"
                PowerManager.THERMAL_STATUS_LIGHT -> "LIGHT"
                PowerManager.THERMAL_STATUS_MODERATE -> "MODERATE"
                PowerManager.THERMAL_STATUS_SEVERE -> "SEVERE"
                PowerManager.THERMAL_STATUS_CRITICAL -> "CRITICAL"
                PowerManager.THERMAL_STATUS_EMERGENCY -> "EMERGENCY"
                PowerManager.THERMAL_STATUS_SHUTDOWN -> "SHUTDOWN"
                else -> "NOMINAL"
            }
        } catch (t: Throwable) {
            "NOMINAL"
        }
    }

    private fun getBatteryLevel(): Int {
        return try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryStatus = context.registerReceiver(null, filter)
            batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        } catch (t: Throwable) {
            -1
        }
    }

    private fun getRamUsageMb(): Float {
        val runtime = Runtime.getRuntime()
        val usedMem = runtime.totalMemory() - runtime.freeMemory()
        return (usedMem / (1024.0f * 1024.0f))
    }

    fun getTelemetry(currentBitrateKbps: Int = 0, bufferHealthSec: Float = 0.0f): NvcTelemetry {
        val avgInference = if (inferenceRuns > 0) (totalInferenceTimeMs / inferenceRuns).toFloat() else 0.0f
        val dropped = droppedFrameCounter.get()
        val totalObserved = activeFrameCounter.get() + dropped
        val lossPercent = if (totalObserved > 0) (dropped.toFloat() / totalObserved * 100.0f) else 0.0f

        val latentAge = if (lastLatentUpdateTimeMs > 0L) (SystemClock.uptimeMillis() - lastLatentUpdateTimeMs) else 0L

        return NvcTelemetry(
            isAvailable = reconstructorSession != null,
            isNnapiActive = isNnapiActive,
            instantFps = currentFps,
            avgFps = currentFps,
            bitrateKbps = currentBitrateKbps,
            avgInferenceLatencyMs = avgInference,
            lastInferenceLatencyMs = lastInferenceLatencyMs,
            latencyP50Ms = getLatencyP50(),
            latencyP95Ms = getLatencyP95(),
            concealedFrames = concealedFrameCounter.get(),
            composedFrames = composedFrameCounter.get(),
            failedFrames = failedFrameCounter.get(),
            droppedFrames = dropped,
            missedDeadlines = missedDeadlineCounter.get(),
            timelineDiscontinuities = timelineDiscontinuityCounter.get(),
            activeFrames = activeFrameCounter.get(),
            executionProvider = getExecutionProvider(),
            cpuUsagePercent = getProcessCpuUsagePercent(),
            ramUsageMb = getRamUsageMb(),
            thermalStatus = getThermalStatusString(),
            bufferHealthSec = bufferHealthSec,
            packetLossPercent = lossPercent,
            rebufferCount = rebufferCounter,
            isPixelLatentExtracted = isPixelLatentExtracted,
            isTwoStagePipelineActive = concealerSession != null,
            latentAgeMs = latentAge
        )
    }

    fun release() {
        try {
            reconstructorSession?.close()
            reconstructorSession = null
            concealerSession?.close()
            concealerSession = null
            env?.close()
            env = null
        } catch (e: Exception) {
            Log.w(TAG, "Error closing ONNX sessions: ${e.message}")
        }
    }
}
