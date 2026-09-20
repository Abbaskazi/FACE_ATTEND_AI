package com.faceattend.ai.face.alignment

import android.graphics.Bitmap
import com.google.mlkit.vision.face.Face

data class AlignedFace(
    val bitmap: Bitmap,
    val alignmentVersion: String,
)

interface FaceAlignment {
    val version: String

    /**
     * `frame` and the landmark coordinates must share one pixel coordinate
     * system. The camera analyzer supplies an upright bitmap and zero rotation
     * after explicitly rotating the raw ImageAnalysis frame. PreviewView
     * scaling/cropping/mirroring is a display concern and is not part of the
     * embedding input.
     */
    fun align(frame: Bitmap, face: Face, rotationDegrees: Int): AlignedFace
}
