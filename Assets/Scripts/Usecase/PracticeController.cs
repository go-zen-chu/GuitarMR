using System;
using System.Collections.Generic;
using GuitarMR.Domain;
using UnityEngine;

namespace GuitarMR.Usecase
{
    /// <summary>
    /// Coordinates the practice session: loads the score, turns pages and
    /// controls the metronome, pushing state changes into the views.
    /// All collaborators are injected so the flow can be tested in isolation.
    /// </summary>
    public sealed class PracticeController
    {
        readonly IMetronome metronome;
        readonly IScoreSource scoreSource;
        readonly IScoreView scoreView;
        readonly IMetronomeView metronomeView;

        ScoreBook book = new ScoreBook(0);
        IReadOnlyList<Texture2D> pages = Array.Empty<Texture2D>();
        string loadStatus = string.Empty;

        /// <summary>Creates the controller with its collaborating ports.</summary>
        public PracticeController(
            IMetronome metronome,
            IScoreSource scoreSource,
            IScoreView scoreView,
            IMetronomeView metronomeView)
        {
            this.metronome = metronome ?? throw new ArgumentNullException(nameof(metronome));
            this.scoreSource = scoreSource ?? throw new ArgumentNullException(nameof(scoreSource));
            this.scoreView = scoreView ?? throw new ArgumentNullException(nameof(scoreView));
            this.metronomeView = metronomeView ?? throw new ArgumentNullException(nameof(metronomeView));
        }

        /// <summary>Loads the score from the source and shows its first page.</summary>
        public void LoadScore()
        {
            var result = scoreSource.Load();
            pages = result.Pages;
            loadStatus = result.StatusMessage;
            book = new ScoreBook(pages.Count);
            ShowCurrentPage();
        }

        /// <summary>Advances to the next score page if one exists.</summary>
        public void ShowNextPage()
        {
            if (book.Next())
            {
                ShowCurrentPage();
            }
        }

        /// <summary>Returns to the previous score page if one exists.</summary>
        public void ShowPreviousPage()
        {
            if (book.Previous())
            {
                ShowCurrentPage();
            }
        }

        /// <summary>Starts the metronome when stopped and stops it when running.</summary>
        public void ToggleMetronome()
        {
            if (metronome.IsRunning)
            {
                metronome.StopTicking();
            }
            else
            {
                metronome.StartTicking();
            }
        }

        /// <summary>Shifts the tempo by the given delta in BPM.</summary>
        public void AddBpm(int delta)
        {
            metronome.SetBpm(metronome.Bpm + delta);
        }

        /// <summary>Pushes the live metronome state into the view; call once per frame.</summary>
        public void Tick()
        {
            metronomeView.ShowState(
                metronome.Bpm,
                metronome.IsRunning,
                metronome.CurrentBeatInBar,
                metronome.BeatsPerBar);
        }

        /// <summary>Shows the current page, or the load status message when the book is empty.</summary>
        void ShowCurrentPage()
        {
            if (book.IsEmpty)
            {
                scoreView.ShowMessage(loadStatus);
                return;
            }
            scoreView.ShowPage(pages[book.CurrentPage], book.CurrentPage, book.PageCount);
        }
    }
}
