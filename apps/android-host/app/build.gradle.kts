plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.beaconremote.host"
    compileSdk = 35

    buildFeatures {
        // BuildConfig.DEBUG lets a debug build, and only a debug build, reach a local test server through `adb reverse`.
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.beaconremote.host"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = if (project.findProperty("beaconUiReview") == "true")
            "com.beaconremote.host.UiLayoutAcceptance" else "com.beaconremote.host.ScreenshotAcceptance"
    }

    // A release build is signed only when the key is supplied through the environment (scripts/Beacon-Android.ps1);
    // the key and its password never live in the repository.
    val releaseKey = System.getenv("BEACON_ANDROID_KEYSTORE")
    signingConfigs {
        if (releaseKey != null) {
            create("release") {
                storeFile = file(releaseKey)
                storePassword = System.getenv("BEACON_ANDROID_STORE_PASSWORD")
                keyAlias = "beacon"
                keyPassword = System.getenv("BEACON_ANDROID_STORE_PASSWORD")
            }
        }
    }
    buildTypes {
        debug {
            // A side-by-side test copy for a phone that already has the real app, which a debug build must never replace:
            // ./gradlew -PlabSuffix=.lab :app:assembleDebug. Without the property the debug build is unchanged.
            (project.findProperty("labSuffix") as String?)?.let { applicationIdSuffix = it }
        }
        release {
            isMinifyEnabled = false
            if (releaseKey != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        // The host is sideloaded for now; Play-only checks do not apply.
        disable += "ForegroundServicePermission"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.crypto.tink:tink-android:1.15.0")
    implementation("io.github.webrtc-sdk:android:144.7559.08")
    // Scans the pairing QR code without needing the camera permission; Google Play services does the camera part.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    testImplementation("junit:junit:4.13.2")
}
