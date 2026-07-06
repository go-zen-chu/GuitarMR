using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Loads score pages from PNG/JPG files in the scores directory, sorted by
    /// file name. Used in the editor for testing and as a device fallback for
    /// scores that were exported as images instead of a PDF.
    /// </summary>
    public sealed class ImageFolderScoreSource : IScoreSource
    {
        static readonly string[] SupportedExtensions = { ".png", ".jpg", ".jpeg" };

        readonly string scoresDirectory;

        /// <summary>Creates a source reading images from the given directory, creating it when missing.</summary>
        public ImageFolderScoreSource(string scoresDirectory)
        {
            this.scoresDirectory = scoresDirectory ?? throw new ArgumentNullException(nameof(scoresDirectory));
        }

        /// <summary>Loads every supported image in the scores directory as one page each.</summary>
        public ScoreLoadResult Load()
        {
            try
            {
                Directory.CreateDirectory(scoresDirectory);
                var imagePaths = Directory.GetFiles(scoresDirectory)
                    .Where(p => SupportedExtensions.Contains(Path.GetExtension(p).ToLowerInvariant()))
                    .OrderBy(p => p)
                    .ToList();
                if (imagePaths.Count == 0)
                {
                    return new ScoreLoadResult(
                        new List<Texture2D>(),
                        $"(Advanced: PNG/JPG pages or PDFs can also be copied to\n{scoresDirectory})");
                }
                var pages = new List<Texture2D>();
                foreach (var path in imagePaths)
                {
                    var texture = LoadTexture(path);
                    if (texture != null)
                    {
                        pages.Add(texture);
                    }
                }
                return new ScoreLoadResult(pages, $"Loaded {pages.Count} image page(s)");
            }
            catch (Exception e)
            {
                Debug.LogError($"failed to load score images: {e}");
                return new ScoreLoadResult(new List<Texture2D>(), $"Failed to load score images:\n{e.Message}");
            }
        }

        /// <summary>Decodes one image file into a texture, returning null on failure.</summary>
        static Texture2D LoadTexture(string path)
        {
            var bytes = File.ReadAllBytes(path);
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!texture.LoadImage(bytes))
            {
                Debug.LogWarning($"could not decode image: {path}");
                UnityEngine.Object.Destroy(texture);
                return null;
            }
            return texture;
        }
    }
}
