using System;
using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
    /// <summary>Score page backed by a texture rendered from a PDF page.</summary>
    public sealed class TextureScorePage : IScorePage
    {
        public Texture2D Texture { get; }

        /// <summary>Wraps one rendered page texture.</summary>
        public TextureScorePage(Texture2D texture)
        {
            Texture = texture ? texture : throw new ArgumentNullException(nameof(texture));
        }
    }
}
