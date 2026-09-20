package com.faceattend.ai.face.alignment

/** A point in an image coordinate system whose origin is the top-left corner. */
data class AlignmentPoint(
    val x: Float,
    val y: Float,
) {
    init {
        require(x.isFinite() && y.isFinite()) { "Alignment point must be finite" }
    }
}
