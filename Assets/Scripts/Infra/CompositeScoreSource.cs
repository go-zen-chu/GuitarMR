using System;
using System.Linq;
using GuitarMR.Usecase;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Tries multiple score sources in order and returns the first non-empty
    /// result, so a device can prefer PDFs but still fall back to images.
    /// </summary>
    public sealed class CompositeScoreSource : IScoreSource
    {
        readonly IScoreSource[] sources;

        /// <summary>Creates a source that queries the given sources in order.</summary>
        public CompositeScoreSource(params IScoreSource[] sources)
        {
            if (sources == null || sources.Length == 0)
            {
                throw new ArgumentException("at least one source is required", nameof(sources));
            }
            this.sources = sources;
        }

        /// <summary>Returns the first result with pages, or the last empty result's message.</summary>
        public ScoreLoadResult Load()
        {
            var results = sources.Select(s => s.Load()).ToList();
            var firstWithPages = results.FirstOrDefault(r => r.Pages.Count > 0);
            return firstWithPages ?? results.Last();
        }
    }
}
