using System.Collections.Generic;

namespace GuitarMR.Usecase
{
    /// <summary>
    /// Opaque handle to one rendered score page. The use case layer only moves
    /// pages around; the presentation layer knows the concrete (engine) type.
    /// This keeps the use case free of engine dependencies and testable outside Unity.
    /// </summary>
    public interface IScorePage
    {
    }

    /// <summary>Result of loading a score: rendered pages plus a user-facing status message.</summary>
    public sealed class ScoreLoadResult
    {
        public IReadOnlyList<IScorePage> Pages { get; }
        public string StatusMessage { get; }

        /// <summary>Creates a load result; pass an empty page list with a message when nothing was loaded.</summary>
        public ScoreLoadResult(IReadOnlyList<IScorePage> pages, string statusMessage)
        {
            Pages = pages ?? new List<IScorePage>();
            StatusMessage = statusMessage ?? string.Empty;
        }
    }

    /// <summary>Lists score files available on the device.</summary>
    public interface IScoreRepository
    {
        /// <summary>Returns full paths of all score PDFs found, sorted by file name.</summary>
        IReadOnlyList<string> ListScorePaths();
    }

    /// <summary>Renders one score document (PDF) into page textures.</summary>
    public interface IScoreDocumentRenderer
    {
        /// <summary>Renders all pages of the document; never throws, failures are reported via the status message.</summary>
        ScoreLoadResult Render(string documentPath);
    }

    /// <summary>Reports and requests access to the shared device storage.</summary>
    public interface IStoragePermission
    {
        bool IsGranted { get; }

        /// <summary>Opens the system screen where the player can grant storage access.</summary>
        void OpenPermissionSettings();
    }

    /// <summary>Persists which score the player used last.</summary>
    public interface IScoreSelectionStore
    {
        /// <summary>Returns the last selected score path, or null when none was saved.</summary>
        string LoadLastScorePath();

        /// <summary>Saves the selected score path for the next session.</summary>
        void SaveLastScorePath(string path);
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
        void ShowPage(IScorePage page, int pageIndex, int pageCount);

        /// <summary>Shows a status message instead of a page (e.g. when no score is available).</summary>
        void ShowMessage(string message);
    }

    /// <summary>Displays the metronome state to the player.</summary>
    public interface IMetronomeView
    {
        /// <summary>Shows the tempo, whether the metronome runs, and the highlighted beat.</summary>
        void ShowState(int bpm, bool isRunning, int beatInBar, int beatsPerBar);
    }

    /// <summary>Displays the score picker list to the player.</summary>
    public interface IScorePickerView
    {
        /// <summary>Shows the score file names with one entry highlighted.</summary>
        void ShowScores(IReadOnlyList<string> fileNames, int highlightedIndex);

        /// <summary>Shows a message inside the picker (no files, missing permission).</summary>
        void ShowMessage(string message);

        /// <summary>Hides the picker.</summary>
        void Hide();
    }
}
