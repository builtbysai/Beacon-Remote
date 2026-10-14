plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.beaconremote.host"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.beaconremote.host"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
    testImplementation("junit:junit:4.13.2")
}
