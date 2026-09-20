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
import com.faceattend.ai.ui.attendance.AttendanceScreen
import com.faceattend.ai.ui.device.DeviceSetupScreen
import com.faceattend.ai.ui.enrollment.EnrollmentScreen
import com.faceattend.ai.ui.home.HomeScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val HOME = "home"
private const val ATTENDANCE = "attendance"
private const val ENROLLMENT = "enrollment"
private const val DEVICE_SETUP = "device-setup"

@Composable
fun AppNavigation() {
    val context = LocalContext.current
    val sessionManager = (context.applicationContext as FaceAttendApplication).deviceSessionManager
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
                onStartAttendance = {
                    navController.navigate(if (sessionManager.hasSession()) ATTENDANCE else DEVICE_SETUP)
                },
                onStartEnrollment = {
                    navController.navigate(if (sessionManager.hasSession()) ENROLLMENT else DEVICE_SETUP)
                },
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
        composable(ATTENDANCE) {
            AttendanceScreen(
                sessionManager = sessionManager,
                onBack = { navController.popBackStack() },
                onSetupRequired = {
                    navController.navigate(DEVICE_SETUP) { launchSingleTop = true }
                },
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
            )
        }
    }
}
