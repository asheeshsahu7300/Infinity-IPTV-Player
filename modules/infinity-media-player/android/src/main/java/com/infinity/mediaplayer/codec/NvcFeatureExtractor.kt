package com.infinity.mediaplayer.codec

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.tanh

/**
 * NVC Analysis Feature Extractor (v1.4.0)
 *
 * Extracts 48-channel spatio-temporal base latent tensors [1, 48, 32, 32] directly
 * from decoded video frame pixels, replacing synthetic stream modulation with
 * real visual content representations.
 *
 * Channel Organization (48 channels total):
 * - Channels 0..15: Color & Luminance representations (RGB, YUV, Color-Opponency, Saturation)
 * - Channels 16..31: Spatial Texture & Gradients (Sobel H/V, Laplacian, Multi-Scale Sub-Bands)
 * - Channels 32..47: Temporal Dynamics & Motion Residuals (Inter-frame variance, Motion magnitude)
 */
class NvcFeatureExtractor(
    val latentChannels: Int = 48,
    val latentHeight: Int = 32,
    val latentWidth: Int = 32
) {

    private val totalElements = latentChannels * latentHeight * latentWidth
    private val previousLuma = FloatArray(latentHeight * latentWidth)
    private var hasPreviousFrame = false
    private val extractedLatent = FloatArray(totalElements)

    /**
     * Extracts a 48-channel base latent tensor from a rendered/decoded Bitmap.
     */
    fun extractLatentFromBitmap(
        sourceFrame: Bitmap,
        outLatent: FloatArray? = null
    ): FloatArray {
        val w = sourceFrame.width
        val h = sourceFrame.height
        val pixels = IntArray(w * h)
        sourceFrame.getPixels(pixels, 0, w, 0, 0, w, h)
        return extractLatentFromRgbPixels(pixels, w, h, outLatent)
    }

    /**
     * Extracts a 48-channel base latent tensor from raw ARGB_8888 pixel buffers.
     * Pure integer bitwise arithmetic without platform dependencies, allowing seamless JVM execution.
     *
     * @param pixels Array of ARGB_8888 integer packed pixels of size srcW * srcH
     * @param srcW Width of the input frame
     * @param srcH Height of the input frame
     * @param outLatent Target array of size 48*32*32. If null, a pre-allocated internal buffer is returned.
     * @return FloatArray containing the normalized [1, 48, 32, 32] latent tensor.
     */
    @Synchronized
    fun extractLatentFromRgbPixels(
        pixels: IntArray,
        srcW: Int,
        srcH: Int,
        outLatent: FloatArray? = null
    ): FloatArray {
        val dest = outLatent ?: extractedLatent
        require(dest.size >= totalElements) { "Output latent array must have size >= $totalElements" }
        require(pixels.size >= srcW * srcH) { "Input pixels array must have size >= srcW * srcH" }

        // Downsample/sample pixels to [latentHeight x latentWidth]
        val sampledR = FloatArray(latentHeight * latentWidth)
        val sampledG = FloatArray(latentHeight * latentWidth)
        val sampledB = FloatArray(latentHeight * latentWidth)
        val sampledY = FloatArray(latentHeight * latentWidth)

        for (y in 0 until latentHeight) {
            val srcY = ((y.toFloat() + 0.5f) / latentHeight * srcH).toInt().coerceIn(0, srcH - 1)
            val rowOffset = srcY * srcW
            for (x in 0 until latentWidth) {
                val srcX = ((x.toFloat() + 0.5f) / latentWidth * srcW).toInt().coerceIn(0, srcW - 1)
                val pixel = pixels[rowOffset + srcX]

                val r = ((pixel ushr 16) and 0xFF) / 255.0f
                val g = ((pixel ushr 8) and 0xFF) / 255.0f
                val b = (pixel and 0xFF) / 255.0f

                val idx = y * latentWidth + x
                sampledR[idx] = r
                sampledG[idx] = g
                sampledB[idx] = b
                // Rec. 709 Luminance
                sampledY[idx] = (0.2126f * r + 0.7152f * g + 0.0722f * b).coerceIn(0.0f, 1.0f)
            }
        }

        // --- 1. Color & Luminance Representations (Channels 0..15) ---
        for (y in 0 until latentHeight) {
            for (x in 0 until latentWidth) {
                val pIdx = y * latentWidth + x
                val r = sampledR[pIdx]
                val g = sampledG[pIdx]
                val b = sampledB[pIdx]
                val luma = sampledY[pIdx]

                val uChroma = (-0.1146f * r - 0.3854f * g + 0.5000f * b) // U chroma
                val vChroma = (0.5000f * r - 0.4542f * g - 0.0458f * b)  // V chroma

                // Base Color planes
                setChannelValue(dest, 0, y, x, normalize(r))
                setChannelValue(dest, 1, y, x, normalize(g))
                setChannelValue(dest, 2, y, x, normalize(b))
                setChannelValue(dest, 3, y, x, normalize(luma))

                // Perceptual color opponent features
                setChannelValue(dest, 4, y, x, tanh((r - g) * 2.0f))
                setChannelValue(dest, 5, y, x, tanh((b - (r + g) * 0.5f) * 2.0f))
                setChannelValue(dest, 6, y, x, normalize(uChroma + 0.5f))
                setChannelValue(dest, 7, y, x, normalize(vChroma + 0.5f))

                // High-contrast saturation & non-linear dynamics
                val maxC = max(r, max(g, b))
                val minC = min(r, min(g, b))
                val sat = if (maxC > 0.001f) (maxC - minC) / maxC else 0.0f
                setChannelValue(dest, 8, y, x, normalize(sat))
                setChannelValue(dest, 9, y, x, normalize(r * r))
                setChannelValue(dest, 10, y, x, normalize(g * g))
                setChannelValue(dest, 11, y, x, normalize(b * b))
                setChannelValue(dest, 12, y, x, normalize(luma * luma))
                setChannelValue(dest, 13, y, x, tanh((r - luma) * 3.0f))
                setChannelValue(dest, 14, y, x, tanh((g - luma) * 3.0f))
                setChannelValue(dest, 15, y, x, tanh((b - luma) * 3.0f))
            }
        }

        // --- 2. Spatial Texture & Gradient Features (Channels 16..31) ---
        for (y in 0 until latentHeight) {
            val yPrev = max(0, y - 1)
            val yNext = min(latentHeight - 1, y + 1)
            for (x in 0 until latentWidth) {
                val xPrev = max(0, x - 1)
                val xNext = min(latentWidth - 1, x + 1)

                val yCenter = sampledY[y * latentWidth + x]

                // Sobel / central difference gradients
                val gradH = (sampledY[y * latentWidth + xNext] - sampledY[y * latentWidth + xPrev]) * 0.5f
                val gradV = (sampledY[yNext * latentWidth + x] - sampledY[yPrev * latentWidth + x]) * 0.5f
                val gradMag = sqrt(gradH * gradH + gradV * gradV)

                // Laplacian 2nd order curvature
                val laplacian = (sampledY[y * latentWidth + xPrev] +
                        sampledY[y * latentWidth + xNext] +
                        sampledY[yPrev * latentWidth + x] +
                        sampledY[yNext * latentWidth + x] - 4.0f * yCenter)

                // Diagonal gradients
                val gradDiag1 = (sampledY[yNext * latentWidth + xNext] - sampledY[yPrev * latentWidth + xPrev]) * 0.5f
                val gradDiag2 = (sampledY[yNext * latentWidth + xPrev] - sampledY[yPrev * latentWidth + xNext]) * 0.5f

                setChannelValue(dest, 16, y, x, tanh(gradH * 4.0f))
                setChannelValue(dest, 17, y, x, tanh(gradV * 4.0f))
                setChannelValue(dest, 18, y, x, normalize(gradMag * 2.0f))
                setChannelValue(dest, 19, y, x, tanh(laplacian * 4.0f))
                setChannelValue(dest, 20, y, x, tanh(gradDiag1 * 4.0f))
                setChannelValue(dest, 21, y, x, tanh(gradDiag2 * 4.0f))

                // High-frequency texture energy
                val hfEnergy = abs(laplacian) + gradMag
                setChannelValue(dest, 22, y, x, normalize(hfEnergy))
                setChannelValue(dest, 23, y, x, normalize(gradH * gradH))
                setChannelValue(dest, 24, y, x, normalize(gradV * gradV))
                setChannelValue(dest, 25, y, x, tanh((gradH - gradV) * 2.0f))
                setChannelValue(dest, 26, y, x, tanh((gradDiag1 - gradDiag2) * 2.0f))

                // Multi-scale spatial frequency filters
                val localMean = (sampledY[yPrev * latentWidth + x] + sampledY[yNext * latentWidth + x] +
                        sampledY[y * latentWidth + xPrev] + sampledY[y * latentWidth + xNext]) * 0.25f
                val localVariance = abs(yCenter - localMean)

                val pIdx = y * latentWidth + x
                val r = sampledR[pIdx]
                val g = sampledG[pIdx]
                val b = sampledB[pIdx]
                val maxC = max(r, max(g, b))
                val minC = min(r, min(g, b))
                val sat = if (maxC > 0.001f) (maxC - minC) / maxC else 0.0f

                setChannelValue(dest, 27, y, x, normalize(localMean))
                setChannelValue(dest, 28, y, x, normalize(localVariance * 4.0f))
                setChannelValue(dest, 29, y, x, tanh((localVariance - gradMag) * 2.0f))
                setChannelValue(dest, 30, y, x, normalize(yCenter * (1.0f - sat)))
                setChannelValue(dest, 31, y, x, normalize(sat * gradMag * 2.0f))
            }
        }

        // --- 3. Temporal Dynamics & Motion Residuals (Channels 32..47) ---
        for (y in 0 until latentHeight) {
            for (x in 0 until latentWidth) {
                val idx = y * latentWidth + x
                val currY = sampledY[idx]

                val tempDelta = if (hasPreviousFrame) (currY - previousLuma[idx]) else 0.0f
                val tempMotionMag = abs(tempDelta)

                setChannelValue(dest, 32, y, x, tanh(tempDelta * 3.0f))
                setChannelValue(dest, 33, y, x, normalize(tempMotionMag * 2.0f))
                setChannelValue(dest, 34, y, x, normalize(tempDelta * tempDelta * 4.0f))
                setChannelValue(dest, 35, y, x, tanh(tempDelta * currY * 3.0f))

                // Spatial acceleration of motion
                val leftDelta = if (x > 0 && hasPreviousFrame) (sampledY[idx - 1] - previousLuma[idx - 1]) else tempDelta
                val rightDelta = if (x < latentWidth - 1 && hasPreviousFrame) (sampledY[idx + 1] - previousLuma[idx + 1]) else tempDelta
                val motionGradH = (rightDelta - leftDelta) * 0.5f

                setChannelValue(dest, 36, y, x, tanh(motionGradH * 4.0f))
                setChannelValue(dest, 37, y, x, normalize(abs(motionGradH) * 2.0f))
                setChannelValue(dest, 38, y, x, normalize(currY * (1.0f - tempMotionMag)))
                setChannelValue(dest, 39, y, x, normalize(currY * tempMotionMag))

                // Residual projection channels 40..47
                val baseLuma = if (hasPreviousFrame) previousLuma[idx] else currY
                setChannelValue(dest, 40, y, x, normalize(baseLuma))
                setChannelValue(dest, 41, y, x, tanh((currY - 0.5f) * 2.0f))
                setChannelValue(dest, 42, y, x, tanh((baseLuma - 0.5f) * 2.0f))
                setChannelValue(dest, 43, y, x, normalize(tempMotionMag * sampledR[idx]))
                setChannelValue(dest, 44, y, x, normalize(tempMotionMag * sampledG[idx]))
                setChannelValue(dest, 45, y, x, normalize(tempMotionMag * sampledB[idx]))
                setChannelValue(dest, 46, y, x, tanh((tempDelta * (sampledR[idx] - sampledB[idx])) * 3.0f))
                setChannelValue(dest, 47, y, x, normalize(1.0f - tempMotionMag))

                // Update previous luma memory
                previousLuma[idx] = currY
            }
        }
        hasPreviousFrame = true

        return dest
    }

    /**
     * Resets the temporal inter-frame memory (e.g. upon seek or track switch).
     */
    fun resetTemporalState() {
        hasPreviousFrame = false
        previousLuma.fill(0.0f)
    }

    private fun setChannelValue(array: FloatArray, channel: Int, y: Int, x: Int, value: Float) {
        val index = (channel * latentHeight + y) * latentWidth + x
        array[index] = value
    }

    private fun normalize(v: Float): Float {
        return v.coerceIn(0.0f, 1.0f)
    }
}
