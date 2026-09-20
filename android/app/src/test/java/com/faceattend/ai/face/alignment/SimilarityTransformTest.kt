package com.faceattend.ai.face.alignment

import org.junit.Assert.assertEquals
import org.junit.Test

class SimilarityTransformTest {
    @Test
    fun fiveSyntheticLandmarksMapToCanonicalPoints() {
        val source = listOf(
            AlignmentPoint(20f, 30f),
            AlignmentPoint(80f, 30f),
            AlignmentPoint(50f, 65f),
            AlignmentPoint(25f, 90f),
            AlignmentPoint(75f, 90f),
        )
        val expected = SimilarityTransform(a = 1.25f, b = 0.15f, translateX = 4f, translateY = -3f)
        val destination = source.map(expected::map)

        val actual = SimilarityTransform.estimate(source, destination)

        source.zip(destination).forEach { (from, to) ->
            val mapped = actual.map(from)
            assertEquals(to.x, mapped.x, 0.0001f)
            assertEquals(to.y, mapped.y, 0.0001f)
        }
    }

    @Test
    fun canonicalTemplateIsTheExplicit112ArcFaceTemplate() {
        assertEquals(112, ArcFaceCanonicalTemplate.WIDTH)
        assertEquals(112, ArcFaceCanonicalTemplate.HEIGHT)
        assertEquals(38.2946f, ArcFaceCanonicalTemplate.points[0].x, 0.00001f)
        assertEquals(51.6963f, ArcFaceCanonicalTemplate.points[0].y, 0.00001f)
        assertEquals(70.7299f, ArcFaceCanonicalTemplate.points[4].x, 0.00001f)
        assertEquals(92.2041f, ArcFaceCanonicalTemplate.points[4].y, 0.00001f)
    }

    @Test
    fun subjectLandmarksAreConvertedToImageOrderForUnmirroredAnalysis() {
        val landmarks = SubjectFivePointLandmarks(
            subjectLeftEye = AlignmentPoint(80f, 20f),
            subjectRightEye = AlignmentPoint(20f, 20f),
            noseBase = AlignmentPoint(50f, 45f),
            subjectLeftMouth = AlignmentPoint(75f, 70f),
            subjectRightMouth = AlignmentPoint(25f, 70f),
        )

        assertEquals(
            listOf(
                AlignmentPoint(20f, 20f),
                AlignmentPoint(80f, 20f),
                AlignmentPoint(50f, 45f),
                AlignmentPoint(25f, 70f),
                AlignmentPoint(75f, 70f),
            ),
            ArcFaceLandmarkOrder.inImageOrder(landmarks),
        )
    }
}
