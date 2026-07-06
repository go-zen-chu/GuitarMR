using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;

namespace GuitarMR.Editor
{
    /// <summary>
    /// One-shot project configuration for Meta Quest 3 and an APK build command,
    /// so a fresh checkout only needs "GuitarMR > Configure Project For Quest 3"
    /// followed by "GuitarMR > Build Android APK".
    /// </summary>
    public static class ProjectConfigurator
    {
        const string MainScenePath = "Assets/Scenes/Main.unity";
        const string XrSettingsAssetPath = "Assets/XR/XRGeneralSettingsPerBuildTarget.asset";
        const string OpenXrLoaderTypeName = "UnityEngine.XR.OpenXR.OpenXRLoader";
        const string ApkOutputPath = "Builds/GuitarMR.apk";

        /// <summary>Applies all Android, XR and input settings required for Quest 3.</summary>
        [MenuItem("GuitarMR/Configure Project For Quest 3")]
        public static void ConfigureProject()
        {
            ConfigurePlayerSettings();
            ConfigureBuildScenes();
            ConfigureXrPlugin();
            EnableOpenXrFeaturesForQuest();
            ConfigureActiveInputHandler();
            AssetDatabase.SaveAssets();
            Debug.Log("GuitarMR: project configured for Meta Quest 3. " +
                      "If the active input handler changed, restart the editor when prompted.");
        }

        /// <summary>Builds the Android APK into the Builds directory.</summary>
        [MenuItem("GuitarMR/Build Android APK")]
        public static void BuildAndroidApk()
        {
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android)
            {
                Debug.LogError("GuitarMR: switch the active platform to Android first " +
                               "(File > Build Profiles > Android > Switch Platform), then run this again.");
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(ApkOutputPath));
            var options = new BuildPlayerOptions
            {
                scenes = new[] { MainScenePath },
                locationPathName = ApkOutputPath,
                target = BuildTarget.Android,
                options = BuildOptions.None,
            };
            var report = BuildPipeline.BuildPlayer(options);
            Debug.Log($"GuitarMR: build {report.summary.result}, output: {ApkOutputPath}");
        }

        /// <summary>Opens the folder used as the scores directory in editor play mode.</summary>
        [MenuItem("GuitarMR/Open Scores Folder (Editor)")]
        public static void OpenScoresFolder()
        {
            var scoresDirectory = Path.Combine(Application.persistentDataPath, "Scores");
            Directory.CreateDirectory(scoresDirectory);
            EditorUtility.RevealInFinder(scoresDirectory);
        }

        /// <summary>Sets identification, scripting backend, graphics and orientation for Quest.</summary>
        static void ConfigurePlayerSettings()
        {
            PlayerSettings.productName = "GuitarMR";
            PlayerSettings.companyName = "go-zen-chu";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.gozenchu.guitarmr");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            // Horizon OS on Quest 3 is based on Android 12L (API 32).
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)32;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            EditorUserBuildSettings.androidBuildSubtarget = MobileTextureSubtarget.ASTC;
        }

        /// <summary>Registers the main scene in the build settings.</summary>
        static void ConfigureBuildScenes()
        {
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(MainScenePath, true) };
        }

        /// <summary>Assigns the OpenXR loader to the Android build target, creating settings assets when missing.</summary>
        static void ConfigureXrPlugin()
        {
            if (!EditorBuildSettings.TryGetConfigObject(
                    XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget perTarget))
            {
                perTarget = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                Directory.CreateDirectory(Path.GetDirectoryName(XrSettingsAssetPath));
                AssetDatabase.CreateAsset(perTarget, XrSettingsAssetPath);
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, perTarget, true);
            }

            var androidSettings = perTarget.SettingsForBuildTarget(BuildTargetGroup.Android);
            if (androidSettings == null)
            {
                androidSettings = ScriptableObject.CreateInstance<XRGeneralSettings>();
                androidSettings.name = "Android XR Settings";
                var manager = ScriptableObject.CreateInstance<XRManagerSettings>();
                manager.name = "Android XR Manager";
                androidSettings.Manager = manager;
                AssetDatabase.AddObjectToAsset(androidSettings, perTarget);
                AssetDatabase.AddObjectToAsset(manager, perTarget);
                perTarget.SetSettingsForBuildTarget(BuildTargetGroup.Android, androidSettings);
            }

            if (!XRPackageMetadataStore.AssignLoader(
                    androidSettings.Manager, OpenXrLoaderTypeName, BuildTargetGroup.Android))
            {
                Debug.LogWarning("GuitarMR: could not assign the OpenXR loader automatically. " +
                                 "Enable OpenXR for Android in Project Settings > XR Plug-in Management.");
            }
            EditorUtility.SetDirty(perTarget);
        }

        /// <summary>
        /// Enables Meta Quest support, the Meta AR features (passthrough etc.) and the
        /// Oculus Touch interaction profile. Features are matched by type name instead of
        /// feature id so this keeps working across package versions.
        /// </summary>
        static void EnableOpenXrFeaturesForQuest()
        {
            FeatureHelpers.RefreshFeatures(BuildTargetGroup.Android);
            var settings = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Android);
            if (settings == null)
            {
                Debug.LogWarning("GuitarMR: OpenXR settings not found yet. " +
                                 "Open Project Settings > XR Plug-in Management > OpenXR once, then rerun this menu.");
                return;
            }
            var enabled = settings.GetFeatures<OpenXRFeature>()
                .Where(f => f != null)
                .Where(f => f.GetType().FullName.Contains("Meta")
                            || f.GetType().FullName.Contains("OculusTouchControllerProfile"))
                .ToList();
            foreach (var feature in enabled)
            {
                feature.enabled = true;
                EditorUtility.SetDirty(feature);
            }
            EditorUtility.SetDirty(settings);
            Debug.Log($"GuitarMR: enabled {enabled.Count} OpenXR feature(s) for Quest: " +
                      string.Join(", ", enabled.Select(f => f.GetType().Name)));
        }

        /// <summary>Switches the active input handler to the Input System package (value 1).</summary>
        static void ConfigureActiveInputHandler()
        {
            var projectSettings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")
                .FirstOrDefault();
            if (projectSettings == null)
            {
                Debug.LogWarning("GuitarMR: could not load ProjectSettings.asset to set the active input handler. " +
                                 "Set 'Active Input Handling' to 'Input System Package' in Project Settings > Player.");
                return;
            }
            var serialized = new SerializedObject(projectSettings);
            var property = serialized.FindProperty("activeInputHandler");
            if (property == null)
            {
                Debug.LogWarning("GuitarMR: 'activeInputHandler' property not found; set it manually in Player settings.");
                return;
            }
            if (property.intValue != 1)
            {
                property.intValue = 1;
                serialized.ApplyModifiedProperties();
            }
        }
    }
}
