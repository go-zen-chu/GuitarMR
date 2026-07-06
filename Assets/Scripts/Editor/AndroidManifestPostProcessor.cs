#if UNITY_ANDROID
using System.IO;
using System.Xml;
using UnityEditor.Android;
using UnityEngine;

namespace GuitarMR.Editor
{
    /// <summary>
    /// Injects the storage permissions into the generated Android manifest.
    /// MANAGE_EXTERNAL_STORAGE ("all files access") is required to read PDFs
    /// from shared storage (Download/Documents) under scoped storage, because
    /// READ_EXTERNAL_STORAGE only covers media files on Android 11+.
    /// </summary>
    public sealed class AndroidManifestPostProcessor : IPostGenerateGradleAndroidProject
    {
        static readonly string[] Permissions =
        {
            "android.permission.MANAGE_EXTERNAL_STORAGE",
            "android.permission.READ_EXTERNAL_STORAGE",
        };

        public int callbackOrder => 100;

        /// <summary>Adds the missing uses-permission entries to the unityLibrary manifest.</summary>
        public void OnPostGenerateGradleAndroidProject(string path)
        {
            var manifestPath = Path.Combine(path, "src", "main", "AndroidManifest.xml");
            if (!File.Exists(manifestPath))
            {
                Debug.LogWarning($"GuitarMR: generated manifest not found at {manifestPath}; " +
                                 "storage permissions were not added.");
                return;
            }
            var document = new XmlDocument();
            document.Load(manifestPath);
            var changed = false;
            foreach (var permission in Permissions)
            {
                changed |= AddPermissionIfMissing(document, permission);
            }
            if (changed)
            {
                document.Save(manifestPath);
            }
        }

        /// <summary>Adds one uses-permission element unless it is already declared.</summary>
        static bool AddPermissionIfMissing(XmlDocument document, string permission)
        {
            const string androidNamespace = "http://schemas.android.com/apk/res/android";
            foreach (XmlElement existing in document.GetElementsByTagName("uses-permission"))
            {
                if (existing.GetAttribute("name", androidNamespace) == permission)
                {
                    return false;
                }
            }
            var element = document.CreateElement("uses-permission");
            var attribute = document.CreateAttribute("android", "name", androidNamespace);
            attribute.Value = permission;
            element.Attributes.Append(attribute);
            document.DocumentElement.AppendChild(element);
            return true;
        }
    }
}
#endif
