using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GuitarMR.Domain;

namespace GuitarMR.Usecase
{
    /// <summary>
    /// Coordinates the practice session: loads scores from the device library,
    /// turns pages, controls the metronome and drives the in-headset score
    /// picker. Controller buttons are modal: while the picker is open the
    /// right-hand inputs navigate the list instead of the score.
    /// All collaborators are injected so the flow can be tested in isolation.
    /// </summary>
    public sealed class PracticeController
    {
        const int BpmStep = 5;
        const string NoScoreGuidance =
            "No score found.\n\n" +
            "Download a PDF with the headset browser or copy one into the " +
            "Download folder over USB, then press the left controller " +
            "Menu button to pick it.";

        readonly IMetronome metronome;
        readonly IScoreRepository scoreRepository;
        readonly IScoreDocumentRenderer documentRenderer;
        readonly IStoragePermission storagePermission;
        readonly IScoreSelectionStore selectionStore;
        readonly IScoreView scoreView;
        readonly IMetronomeView metronomeView;
        readonly IScorePickerView pickerView;

        List<string> scorePaths = new List<string>();
        ScoreCatalog catalog = new ScoreCatalog(0, 0);
        bool pickerOpen;

        ScoreBook book = new ScoreBook(0);
        IReadOnlyList<IScorePage> pages = Array.Empty<IScorePage>();
        string currentScorePath;

        /// <summary>Creates the controller with its collaborating ports.</summary>
        public PracticeController(
            IMetronome metronome,
            IScoreRepository scoreRepository,
            IScoreDocumentRenderer documentRenderer,
            IStoragePermission storagePermission,
            IScoreSelectionStore selectionStore,
            IScoreView scoreView,
            IMetronomeView metronomeView,
            IScorePickerView pickerView)
        {
            this.metronome = metronome ?? throw new ArgumentNullException(nameof(metronome));
            this.scoreRepository = scoreRepository ?? throw new ArgumentNullException(nameof(scoreRepository));
            this.documentRenderer = documentRenderer ?? throw new ArgumentNullException(nameof(documentRenderer));
            this.storagePermission = storagePermission ?? throw new ArgumentNullException(nameof(storagePermission));
            this.selectionStore = selectionStore ?? throw new ArgumentNullException(nameof(selectionStore));
            this.scoreView = scoreView ?? throw new ArgumentNullException(nameof(scoreView));
            this.metronomeView = metronomeView ?? throw new ArgumentNullException(nameof(metronomeView));
            this.pickerView = pickerView ?? throw new ArgumentNullException(nameof(pickerView));
        }

        /// <summary>Scans the score library and shows the last used (or first) score.</summary>
        public void Initialize()
        {
            pickerView.Hide();
            RefreshLibrary();
            var initial = ChooseInitialScorePath();
            if (initial != null)
            {
                LoadScore(initial);
                return;
            }
            scoreView.ShowMessage(NoScoreGuidance);
        }

        /// <summary>Handles right controller A: confirms the picker selection or turns to the next page.</summary>
        public void OnRightPrimary()
        {
            if (pickerOpen)
            {
                ConfirmPickerSelection();
                return;
            }
            if (book.Next())
            {
                ShowCurrentPage();
            }
        }

        /// <summary>Handles right controller B: closes the picker or turns to the previous page.</summary>
        public void OnRightSecondary()
        {
            if (pickerOpen)
            {
                ClosePicker();
                return;
            }
            if (book.Previous())
            {
                ShowCurrentPage();
            }
        }

        /// <summary>Handles right thumbstick flicks: moves the picker highlight or shifts the tempo.</summary>
        public void OnRightStickStep(int direction)
        {
            if (pickerOpen)
            {
                // Stick up (direction +1) moves the highlight towards the top of the list.
                if (catalog.Move(-direction))
                {
                    ShowPickerList();
                }
                return;
            }
            metronome.SetBpm(metronome.Bpm + direction * BpmStep);
        }

        /// <summary>Starts the metronome when stopped and stops it when running.</summary>
        public void OnToggleMetronome()
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

        /// <summary>Opens the score picker, or closes it when already open.</summary>
        public void OnTogglePicker()
        {
            if (pickerOpen)
            {
                ClosePicker();
                return;
            }
            OpenPicker();
        }

        /// <summary>Rescans the library when the app regains focus, e.g. after granting storage access.</summary>
        public void OnAppFocusRegained()
        {
            if (!pickerOpen)
            {
                return;
            }
            RefreshLibrary();
            catalog = new ScoreCatalog(scorePaths.Count, catalog.Highlighted);
            ShowPickerList();
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

        /// <summary>Reloads the list of score files from the repository.</summary>
        void RefreshLibrary()
        {
            scorePaths = scoreRepository.ListScorePaths().ToList();
        }

        /// <summary>Returns the last used score if it still exists, otherwise the first available one.</summary>
        string ChooseInitialScorePath()
        {
            var last = selectionStore.LoadLastScorePath();
            if (last != null && scorePaths.Contains(last))
            {
                return last;
            }
            return scorePaths.FirstOrDefault();
        }

        /// <summary>Renders the document and shows its first page, remembering the selection on success.</summary>
        void LoadScore(string path)
        {
            var result = documentRenderer.Render(path);
            if (result.Pages.Count == 0)
            {
                scoreView.ShowMessage(result.StatusMessage);
                return;
            }
            pages = result.Pages;
            book = new ScoreBook(pages.Count);
            currentScorePath = path;
            selectionStore.SaveLastScorePath(path);
            ShowCurrentPage();
        }

        /// <summary>Opens the picker with the current score highlighted.</summary>
        void OpenPicker()
        {
            RefreshLibrary();
            var initialIndex = currentScorePath == null ? 0 : scorePaths.IndexOf(currentScorePath);
            catalog = new ScoreCatalog(scorePaths.Count, initialIndex < 0 ? 0 : initialIndex);
            pickerOpen = true;
            ShowPickerList();
        }

        /// <summary>Closes the picker and returns the buttons to score control.</summary>
        void ClosePicker()
        {
            pickerOpen = false;
            pickerView.Hide();
        }

        /// <summary>Loads the highlighted score, or opens the permission settings when access is missing.</summary>
        void ConfirmPickerSelection()
        {
            if (!storagePermission.IsGranted)
            {
                storagePermission.OpenPermissionSettings();
                return;
            }
            if (catalog.IsEmpty)
            {
                return;
            }
            var path = scorePaths[catalog.Highlighted];
            ClosePicker();
            LoadScore(path);
        }

        /// <summary>Renders the picker content for the current library and permission state.</summary>
        void ShowPickerList()
        {
            if (!storagePermission.IsGranted)
            {
                pickerView.ShowMessage(
                    "File access is not granted.\n\n" +
                    "Press A to open the system settings and allow " +
                    "\"management of all files\", then return here.");
                return;
            }
            if (catalog.IsEmpty)
            {
                pickerView.ShowMessage(
                    "No PDF files found.\n\n" +
                    "Download a PDF with the headset browser or copy one " +
                    "to the Download folder over USB, then reopen this picker (Menu).");
                return;
            }
            var names = scorePaths.Select(Path.GetFileName).ToList();
            pickerView.ShowScores(names, catalog.Highlighted);
        }

        /// <summary>Shows the current page, assuming the book is not empty.</summary>
        void ShowCurrentPage()
        {
            scoreView.ShowPage(pages[book.CurrentPage], book.CurrentPage, book.PageCount);
        }
    }
}
