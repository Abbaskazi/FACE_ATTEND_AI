package com.faceattend.ai.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.faceattend.ai.FaceAttendApplication
import com.faceattend.ai.attendance.AttendanceAction
import com.faceattend.ai.diagnostics.RecognitionLogDetailScreen
import com.faceattend.ai.diagnostics.RecognitionLogsScreen
import com.faceattend.ai.diagnostics.EnrollmentInputDiagnosticsScreen
import com.faceattend.ai.ui.attendance.AttendanceScreen
import com.faceattend.ai.ui.device.DeviceSetupScreen
import com.faceattend.ai.ui.enrollment.EnrollmentScreen
import com.faceattend.ai.ui.home.HomeScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.navigation.NavType
import androidx.navigation.navArgument
import androidx.compose.material3.ExperimentalMaterial3Api

private const val HOME = "home"
private const val CHECK_IN = "check-in"
private const val CHECK_OUT = "check-out"
private const val ENROLLMENT = "enrollment"
private const val DEVICE_SETUP = "device-setup"
private const val RECOGNITION_LOGS = "recognition-logs"
private const val ENROLLMENT_INPUT_DIAGNOSTICS = "enrollment-input-diagnostics"
private const val RECOGNITION_LOG_DETAIL = "recognition-log/{logId}"

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun AppNavigation() {
    val context = LocalContext.current
    val application = context.applicationContext as FaceAttendApplication
    val sessionManager = application.deviceSessionManager
    val recognitionLogRepository = application.recognitionLogRepository
    val enrollmentInputDiagnosticRepository = application.enrollmentInputDiagnosticRepository
    val navController = rememberNavController()
    var sessionRestored by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            sessionManager.restore()
            sessionManager.getValidAccessToken()
        }
        sessionRestored = true
    }

    if (!sessionRestored) return

    val startDestination = if (sessionManager.hasSession()) HOME else DEVICE_SETUP
    NavHost(navController = navController, startDestination = startDestination) {
        composable(HOME) {
            HomeScreen(
                onStartCheckIn = {
                    navController.navigate(if (sessionManager.hasSession()) CHECK_IN else DEVICE_SETUP)
                },
                onStartCheckOut = {
                    navController.navigate(if (sessionManager.hasSession()) CHECK_OUT else DEVICE_SETUP)
                },
                onStartEnrollment = {
                    navController.navigate(if (sessionManager.hasSession()) ENROLLMENT else DEVICE_SETUP)
                },
                onOpenRecognitionLogs = { navController.navigate(RECOGNITION_LOGS) },
            )
        }
        composable(DEVICE_SETUP) {
            DeviceSetupScreen(
                sessionManager = sessionManager,
                onSetupSuccess = {
                    navController.navigate(HOME) {
                        popUpTo(DEVICE_SETUP) { inclusive = true }
                    }
                },
            )
        }
        composable(CHECK_IN) {
            AttendanceScreen(
                sessionManager = sessionManager,
                action = AttendanceAction.CHECK_IN,
                onBack = { navController.popBackStack() },
                onSetupRequired = {
                    navController.navigate(DEVICE_SETUP) { launchSingleTop = true }
                },
                recognitionLogRepository = recognitionLogRepository,
            )
        }
        composable(CHECK_OUT) {
            AttendanceScreen(
                sessionManager = sessionManager,
                action = AttendanceAction.CHECK_OUT,
                onBack = { navController.popBackStack() },
                onSetupRequired = {
                    navController.navigate(DEVICE_SETUP) { launchSingleTop = true }
                },
                recognitionLogRepository = recognitionLogRepository,
            )
        }
        composable(ENROLLMENT) {
            EnrollmentScreen(
                sessionManager = sessionManager,
                onBack = { navController.popBackStack() },
                onEnrollmentSuccess = { navController.popBackStack(HOME, false) },
                onSetupRequired = {
                    navController.navigate(DEVICE_SETUP) { launchSingleTop = true }
                },
                recognitionLogRepository = recognitionLogRepository,
            )
        }
        composable(RECOGNITION_LOGS) {
            RecognitionLogsScreen(
                repository = recognitionLogRepository,
                onBack = { navController.popBackStack() },
                onOpenEnrollmentDiagnostics = { navController.navigate(ENROLLMENT_INPUT_DIAGNOSTICS) },
                onOpenLog = { logId ->
                    navController.navigate("recognition-log/$logId")
                },
            )
        }
        composable(ENROLLMENT_INPUT_DIAGNOSTICS) {
            EnrollmentInputDiagnosticsScreen(
                repository = enrollmentInputDiagnosticRepository,
                onBack = { navController.popBackStack() },
            )
        }
        composable(
            route = RECOGNITION_LOG_DETAIL,
            arguments = listOf(navArgument("logId") { type = NavType.StringType }),
        ) { entry ->
            val log = recognitionLogRepository.find(entry.arguments?.getString("logId").orEmpty())
            RecognitionLogDetailScreen(
                log = log,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
