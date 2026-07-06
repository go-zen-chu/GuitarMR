using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Lists score PDFs from a fixed set of directories (the app's own Scores
    /// folder plus shared storage folders like Download/Documents on device).
    /// Directories that are missing or not readable are skipped silently, so
    /// the list degrades gracefully before storage access is granted.
    /// </summary>
    public sealed class SharedStorageScoreRepository : IScoreRepository
    {
        readonly string[] directories;

        /// <summary>Creates a repository scanning the given directories in order.</summary>
        public SharedStorageScoreRepository(string[] directories)
        {
            if (directories == null || directories.Length == 0)
            {
                throw new ArgumentException("at least one directory is required", nameof(directories));
            }
            this.directories = directories;
        }

        /// <summary>Returns full paths of all PDFs found, sorted by file name.</summary>
        public IReadOnlyList<string> ListScorePaths()
        {
            var paths = new List<string>();
            foreach (var directory in directories)
            {
                paths.AddRange(ListPdfsIn(directory));
            }
            return paths.OrderBy(Path.GetFileName).ToList();
        }

        /// <summary>Lists PDFs in one directory, returning an empty list when it is unreadable.</summary>
        static IEnumerable<string> ListPdfsIn(string directory)
        {
            try
            {
                if (!Directory.Exists(directory))
                {
                    return Enumerable.Empty<string>();
                }
                return Directory.GetFiles(directory, "*.pdf");
            }
            catch (Exception e)
            {
                Debug.LogWarning($"skipping unreadable score directory {directory}: {e.Message}");
                return Enumerable.Empty<string>();
            }
        }
    }
}
