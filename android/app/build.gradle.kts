plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.faceattend.ai"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.faceattend.ai"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        buildConfigField(
            "String",
            "SUPABASE_URL",
            gradleString("supabaseUrl", "SUPABASE_URL", "VITE_SUPABASE_URL"),
        )
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            gradleString("supabaseAnonKey", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"),
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

fun gradleString(propertyName: String, environmentName: String, webEnvName: String): String {
    val value = providers.gradleProperty(propertyName).orNull?.takeIf { it.isNotBlank() }
        ?: providers.environmentVariable(environmentName).orNull?.takeIf { it.isNotBlank() }
        ?: webEnvValue(webEnvName)
        ?: ""
    return "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
}

fun webEnvValue(name: String): String? {
    val envFile = rootProject.projectDir.parentFile.resolve("web/.env.local")
    if (!envFile.isFile) return null

    val assignment = Regex("^\\s*(?:export\\s+)?${Regex.escape(name)}\\s*=\\s*(.*?)\\s*$")
    val rawValue = envFile.useLines { lines ->
        lines.mapNotNull { line -> assignment.matchEntire(line)?.groupValues?.get(1) }
            .firstOrNull()
    } ?: return null

    return rawValue.trim().let { value ->
        if (value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith('\'') && value.endsWith('\'')))
        ) {
            value.substring(1, value.length - 1)
        } else {
            value
        }
    }.takeIf { it.isNotBlank() }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.mlkit:face-detection:16.1.7")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.21.1")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
