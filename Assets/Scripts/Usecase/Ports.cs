using System.Collections.Generic;
using UnityEngine;

namespace GuitarMR.Usecase
{
    /// <summary>Result of loading a score: rendered page textures plus a user-facing status message.</summary>
    public sealed class ScoreLoadResult
    {
        public IReadOnlyList<Texture2D> Pages { get; }
        public string StatusMessage { get; }

        /// <summary>Creates a load result; pass an empty page list with a message when nothing was loaded.</summary>
        public ScoreLoadResult(IReadOnlyList<Texture2D> pages, string statusMessage)
        {
            Pages = pages ?? new List<Texture2D>();
            StatusMessage = statusMessage ?? string.Empty;
        }
    }

    /// <summary>Provides score pages as textures, e.g. from a PDF file or an image folder.</summary>
    public interface IScoreSource
    {
        /// <summary>Loads all score pages; never throws, failures are reported via the status message.</summary>
        ScoreLoadResult Load();
    }

    /// <summary>Plays metronome clicks and reports the current beat for display.</summary>
    public interface IMetronome
    {
        bool IsRunning { get; }
        int Bpm { get; }
        int BeatsPerBar { get; }

        /// <summary>Zero-based beat position inside the current bar, or -1 when not audible yet.</summary>
        int CurrentBeatInBar { get; }

        /// <summary>Starts clicking from beat zero after a short scheduling delay.</summary>
        void StartTicking();

        /// <summary>Stops clicking immediately.</summary>
        void StopTicking();

        /// <summary>Changes the tempo, clamped to the supported range, keeping the beat phase.</summary>
        void SetBpm(int bpm);
    }

    /// <summary>Displays score pages to the player.</summary>
    public interface IScoreView
    {
        /// <summary>Shows one rendered score page with paging information.</summary>
        void ShowPage(Texture2D page, int pageIndex, int pageCount);

        /// <summary>Shows a status message instead of a page (e.g. when no score is available).</summary>
        void ShowMessage(string message);
    }

    /// <summary>Displays the metronome state to the player.</summary>
    public interface IMetronomeView
    {
        /// <summary>Shows the tempo, whether the metronome runs, and the highlighted beat.</summary>
        void ShowState(int bpm, bool isRunning, int beatInBar, int beatsPerBar);
    }
}
