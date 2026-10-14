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
    testImplementation("junit:junit:4.13.2")
}
