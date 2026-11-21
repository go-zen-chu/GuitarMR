using System;
using System.IO;
using UnityEngine;

namespace GuitarMR.App
{
    /// <summary>
    /// Reads whether this launch asked for the on-device smoke check
    /// (scripts/run-device-tests.sh starts the app with
    /// <c>am start ... --es guitarmr.smoke &lt;score file name&gt;</c>).
    /// Only development builds honor the request, so release builds always start normally.
    /// </summary>
    public static class SmokeLaunchRequest
    {
        const string IntentExtraKey = "guitarmr.smoke";

        /// <summary>Returns the score file name to check against, or null for a normal launch.</summary>
        public static string ReadTargetScoreName()
        {
            if (!Debug.isDebugBuild)
            {
                return null;
            }
            var name = ReadIntentExtra();
            if (string.IsNullOrEmpty(name))
            {
                return null;
            }
            if (name != Path.GetFileName(name) || !name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            {
                Debug.LogWarning($"ignoring the smoke request: {IntentExtraKey} must be a PDF file name, got '{name}'");
                return null;
            }
            return name;
        }

        /// <summary>Returns the smoke extra of the intent that started the activity, or null when absent.</summary>
        static string ReadIntentExtra()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                using var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
                using var intent = activity.Call<AndroidJavaObject>("getIntent");
                return intent?.Call<string>("getStringExtra", IntentExtraKey);
            }
            catch (AndroidJavaException e)
            {
                Debug.LogWarning($"could not read the launch intent: {e.Message}");
                return null;
            }
#else
            return null;
#endif
        }
    }
}
