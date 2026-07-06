using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
    /// <summary>Persists the last selected score path in Unity's PlayerPrefs.</summary>
    public sealed class PlayerPrefsScoreSelectionStore : IScoreSelectionStore
    {
        const string LastScorePathKey = "GuitarMR.LastScorePath";

        /// <summary>Returns the last selected score path, or null when none was saved.</summary>
        public string LoadLastScorePath()
        {
            var path = PlayerPrefs.GetString(LastScorePathKey, string.Empty);
            return string.IsNullOrEmpty(path) ? null : path;
        }

        /// <summary>Saves the selected score path for the next session.</summary>
        public void SaveLastScorePath(string path)
        {
            PlayerPrefs.SetString(LastScorePathKey, path ?? string.Empty);
            PlayerPrefs.Save();
        }
    }
}
