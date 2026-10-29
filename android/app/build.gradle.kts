import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing comes from the environment so the keystore never lives in the repo.
// Without it both builds fall back to the debug key (fine for local sideloading);
// CI refuses to publish a release that is not signed with the release key.
val releaseKeystore: String? = System.getenv("TKY_KEYSTORE_FILE")
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
                keyAlias = System.getenv("TKY_KEY_ALIAS")
                keyPassword = System.getenv("TKY_KEY_PASSWORD")
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
            // Same key as release so CI builds update the installed preview in place.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
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
