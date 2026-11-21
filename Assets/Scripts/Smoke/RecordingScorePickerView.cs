using System;
using System.Collections.Generic;
using System.Linq;
using GuitarMR.Usecase;

namespace GuitarMR.Smoke
{
    /// <summary>Picker view decorator that remembers the list on display, so scripted checks can observe it.</summary>
    public sealed class RecordingScorePickerView : IScorePickerView
    {
        readonly IScorePickerView inner;

        public bool IsVisible { get; private set; }
        public IReadOnlyList<string> FileNames { get; private set; } = new List<string>();

        /// <summary>Index of the highlighted entry, or -1 when no list is shown.</summary>
        public int Highlighted { get; private set; } = -1;

        public string LastMessage { get; private set; } = string.Empty;

        /// <summary>Creates the decorator around the view that actually displays the picker.</summary>
        public RecordingScorePickerView(IScorePickerView inner)
        {
            this.inner = inner ?? throw new ArgumentNullException(nameof(inner));
        }

        /// <summary>Shows the list on the inner view and records it.</summary>
        public void ShowScores(IReadOnlyList<string> fileNames, int highlightedIndex)
        {
            IsVisible = true;
            FileNames = fileNames?.ToList() ?? new List<string>();
            Highlighted = highlightedIndex;
            inner.ShowScores(fileNames, highlightedIndex);
        }

        /// <summary>Shows the message on the inner view and records it.</summary>
        public void ShowMessage(string message)
        {
            IsVisible = true;
            FileNames = new List<string>();
            Highlighted = -1;
            LastMessage = message ?? string.Empty;
            inner.ShowMessage(message);
        }

        /// <summary>Hides the inner view and records that the picker is closed.</summary>
        public void Hide()
        {
            IsVisible = false;
            inner.Hide();
        }
    }
}
