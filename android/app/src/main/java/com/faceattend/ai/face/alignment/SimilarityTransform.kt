package com.faceattend.ai.face.alignment

/** A 2D similarity transform: uniform scale, rotation, and translation. */
data class SimilarityTransform(
    val a: Float,
    val b: Float,
    val translateX: Float,
    val translateY: Float,
) {
    fun map(point: AlignmentPoint): AlignmentPoint = AlignmentPoint(
        x = a * point.x - b * point.y + translateX,
        y = b * point.x + a * point.y + translateY,
    )

    companion object {
        /** Estimates the least-squares similarity transform source -> destination. */
        fun estimate(
            source: List<AlignmentPoint>,
            destination: List<AlignmentPoint>,
        ): SimilarityTransform {
            require(source.size == destination.size) {
                "Source and destination landmark counts must match"
            }
            require(source.size >= 3) { "At least three landmarks are required" }

            val sourceCenter = centroid(source)
            val destinationCenter = centroid(destination)
            var denominator = 0.0
            var aNumerator = 0.0
            var bNumerator = 0.0

            source.zip(destination).forEach { (from, to) ->
                val sourceX = from.x - sourceCenter.x
                val sourceY = from.y - sourceCenter.y
                val destinationX = to.x - destinationCenter.x
                val destinationY = to.y - destinationCenter.y
                denominator += sourceX * sourceX + sourceY * sourceY
                aNumerator += sourceX * destinationX + sourceY * destinationY
                bNumerator += sourceX * destinationY - sourceY * destinationX
            }
            require(denominator > 1.0e-6) { "Source landmarks are degenerate" }

            val a = aNumerator / denominator
            val b = bNumerator / denominator
            return SimilarityTransform(
                a = a.toFloat(),
                b = b.toFloat(),
                translateX = (destinationCenter.x - a * sourceCenter.x + b * sourceCenter.y)
                    .toFloat(),
                translateY = (destinationCenter.y - b * sourceCenter.x - a * sourceCenter.y)
                    .toFloat(),
            )
        }

        private fun centroid(points: List<AlignmentPoint>): AlignmentPoint = AlignmentPoint(
            x = (points.sumOf { it.x.toDouble() } / points.size).toFloat(),
            y = (points.sumOf { it.y.toDouble() } / points.size).toFloat(),
        )
    }
}
