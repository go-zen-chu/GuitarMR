using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
#if UNITY_ANDROID && !UNITY_EDITOR
    /// <summary>
    /// Storage access via Android's "all files access" (MANAGE_EXTERNAL_STORAGE).
    /// Plain READ_EXTERNAL_STORAGE cannot read non-media files such as PDFs
    /// owned by other apps under scoped storage (Android 11+), so the player
    /// grants this app file management access once in the system settings.
    /// </summary>
    public sealed class AndroidStoragePermission : IStoragePermission
    {
        public bool IsGranted
        {
            get
            {
                using var environment = new AndroidJavaClass("android.os.Environment");
                return environment.CallStatic<bool>("isExternalStorageManager");
            }
        }

        /// <summary>Opens the system "all files access" settings page for this app.</summary>
        public void OpenPermissionSettings()
        {
            using var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
            using var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
            try
            {
                using var uriClass = new AndroidJavaClass("android.net.Uri");
                using var uri = uriClass.CallStatic<AndroidJavaObject>("parse", "package:" + Application.identifier);
                using var intent = new AndroidJavaObject(
                    "android.content.Intent",
                    "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
                    uri);
                activity.Call("startActivity", intent);
            }
            catch (AndroidJavaException e)
            {
                // Some OS builds do not resolve the per-app screen; fall back to the global one.
                Debug.LogWarning($"falling back to the global all-files-access screen: {e.Message}");
                using var intent = new AndroidJavaObject(
                    "android.content.Intent",
                    "android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION");
                activity.Call("startActivity", intent);
            }
        }
    }
#endif

    /// <summary>Permission stub for platforms without scoped storage, such as the editor.</summary>
    public sealed class GrantedStoragePermission : IStoragePermission
    {
        public bool IsGranted => true;

        /// <summary>No-op; access is always available on this platform.</summary>
        public void OpenPermissionSettings()
        {
        }
    }
}
