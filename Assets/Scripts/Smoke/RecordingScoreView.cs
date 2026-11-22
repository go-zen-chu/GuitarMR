using System;
using GuitarMR.Usecase;

namespace GuitarMR.Smoke
{
    /// <summary>Score view decorator that remembers what was last shown, so scripted checks can observe it.</summary>
    public sealed class RecordingScoreView : IScoreView
    {
        readonly IScoreView inner;

        /// <summary>Number of ShowPage calls so far.</summary>
        public int ShownPageCount { get; private set; }

        /// <summary>Index of the page on display, or -1 while a message is shown.</summary>
        public int PageIndex { get; private set; } = -1;

        public int PageCount { get; private set; }
        public string LastMessage { get; private set; } = string.Empty;

        /// <summary>Creates the decorator around the view that actually displays the pages.</summary>
        public RecordingScoreView(IScoreView inner)
        {
            this.inner = inner ?? throw new ArgumentNullException(nameof(inner));
        }

        /// <summary>Shows the page on the inner view and records its position.</summary>
        public void ShowPage(IScorePage page, int pageIndex, int pageCount)
        {
            ShownPageCount++;
            PageIndex = pageIndex;
            PageCount = pageCount;
            inner.ShowPage(page, pageIndex, pageCount);
        }

        /// <summary>Shows the message on the inner view and records it.</summary>
        public void ShowMessage(string message)
        {
            PageIndex = -1;
            LastMessage = message ?? string.Empty;
            inner.ShowMessage(message);
        }
    }
}
