import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing comes from the environment so the keystores never live in the repo.
// The release and the preview app have their own keys, so PR builds never hold the
// release key. Without them both builds fall back to the debug key (fine for local
// sideloading); CI refuses to publish an APK that carries the debug key.
val releaseKeystore: String? = System.getenv("TKY_KEYSTORE_FILE")
val previewKeystore: String? = System.getenv("TKY_PREVIEW_KEYSTORE_FILE")
val versionBase = providers.gradleProperty("tky.versionBase").get()

// The phone page is built by the web workspace (pnpm --filter @guitarmr/demo build:android)
// and shipped as the app's assets under web/.
val webPage = rootProject.layout.projectDirectory.dir("../web/packages/demo/dist/android")
val webAssets = layout.buildDirectory.dir("generated/webAssets")

val syncWebPage by tasks.registering(Sync::class) {
    from(webPage)
    into(webAssets.map { it.dir("web") })
    doFirst {
        if (!webPage.file("index.html").asFile.exists()) {
            throw GradleException(
                "${webPage.asFile} is missing: run \"pnpm --filter @guitarmr/demo build:android\" in web/ first",
            )
        }
    }
}

android {
    namespace = "xyz.amasuda.tky"
    compileSdk = 36

    defaultConfig {
        applicationId = "xyz.amasuda.tky"
        minSdk = 29
        targetSdk = 36
        versionCode = (System.getenv("TKY_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("TKY_VERSION_NAME") ?: "$versionBase.0-dev"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("TKY_KEYSTORE_PASSWORD")
                keyAlias = "tky"
                keyPassword = System.getenv("TKY_KEY_PASSWORD")
            }
        }
        if (previewKeystore != null) {
            create("preview") {
                storeFile = file(previewKeystore)
                // PKCS12 keystores use one password for the store and the key.
                storePassword = System.getenv("TKY_PREVIEW_KEYSTORE_PASSWORD")
                keyAlias = "tky"
                keyPassword = System.getenv("TKY_PREVIEW_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        // The preview app for trying out PRs: installs next to the release app with its own data.
        debug {
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-" + (System.getenv("TKY_PREVIEW_LABEL") ?: "preview")
            // One preview key for every PR, so CI builds update the installed preview in place.
            signingConfig = signingConfigs.findByName("preview") ?: signingConfigs.getByName("debug")
        }
    }

    sourceSets["main"].assets.srcDir(webAssets)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
    }
}

tasks.named("preBuild") { dependsOn(syncWebPage) }

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
