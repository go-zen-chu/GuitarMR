using System.Collections.Generic;
using System.Linq;
using GuitarMR.Usecase;
using NUnit.Framework;

namespace GuitarMR.Tests
{
    /// <summary>
    /// BDD-style behavior tests for the practice session flow, including the
    /// modal input routing between score control and the picker. All ports are
    /// replaced with in-memory fakes so no engine or device is involved.
    /// </summary>
    public sealed class PracticeControllerTests
    {
        sealed class FakePage : IScorePage
        {
            public string Path;
            public int Index;
        }

        sealed class FakeMetronome : IMetronome
        {
            public bool IsRunning { get; private set; }
            public int Bpm { get; private set; } = 90;
            public int BeatsPerBar => 4;
            public int CurrentBeatInBar => IsRunning ? 0 : -1;

            public void StartTicking() => IsRunning = true;

            public void StopTicking() => IsRunning = false;

            public void SetBpm(int bpm) => Bpm = bpm;
        }

        sealed class FakeScoreRepository : IScoreRepository
        {
            public List<string> Paths = new List<string>();

            public IReadOnlyList<string> ListScorePaths() => Paths.ToList();
        }

        sealed class FakeDocumentRenderer : IScoreDocumentRenderer
        {
            public int PagesPerDocument = 2;
            public HashSet<string> FailingPaths = new HashSet<string>();
            public List<string> RenderedPaths = new List<string>();

            public ScoreLoadResult Render(string documentPath)
            {
                RenderedPaths.Add(documentPath);
                if (FailingPaths.Contains(documentPath))
                {
                    return new ScoreLoadResult(new List<IScorePage>(), "render failed");
                }
                var pages = Enumerable.Range(0, PagesPerDocument)
                    .Select(i => (IScorePage)new FakePage { Path = documentPath, Index = i })
                    .ToList();
                return new ScoreLoadResult(pages, "loaded");
            }
        }

        sealed class FakeStoragePermission : IStoragePermission
        {
            public bool Granted = true;
            public int OpenSettingsCalls;

            public bool IsGranted => Granted;

            public void OpenPermissionSettings() => OpenSettingsCalls++;
        }

        sealed class FakeSelectionStore : IScoreSelectionStore
        {
            public string LastPath;

            public string LoadLastScorePath() => LastPath;

            public void SaveLastScorePath(string path) => LastPath = path;
        }

        sealed class SpyScoreView : IScoreView
        {
            public IScorePage LastPage;
            public int LastPageIndex = -1;
            public int LastPageCount = -1;
            public string LastMessage;

            public void ShowPage(IScorePage page, int pageIndex, int pageCount)
            {
                LastPage = page;
                LastPageIndex = pageIndex;
                LastPageCount = pageCount;
                LastMessage = null;
            }

            public void ShowMessage(string message)
            {
                LastMessage = message;
                LastPage = null;
            }
        }

        sealed class SpyMetronomeView : IMetronomeView
        {
            public int LastBpm = -1;

            public void ShowState(int bpm, bool isRunning, int beatInBar, int beatsPerBar) => LastBpm = bpm;
        }

        sealed class SpyPickerView : IScorePickerView
        {
            public bool Visible;
            public IReadOnlyList<string> LastFileNames;
            public int LastHighlighted = -1;
            public string LastMessage;

            public void ShowScores(IReadOnlyList<string> fileNames, int highlightedIndex)
            {
                Visible = true;
                LastFileNames = fileNames;
                LastHighlighted = highlightedIndex;
                LastMessage = null;
            }

            public void ShowMessage(string message)
            {
                Visible = true;
                LastMessage = message;
            }

            public void Hide() => Visible = false;
        }

        /// <summary>Bundles the controller with all its fakes for concise test setup.</summary>
        sealed class Harness
        {
            public readonly FakeMetronome Metronome = new FakeMetronome();
            public readonly FakeScoreRepository Repository = new FakeScoreRepository();
            public readonly FakeDocumentRenderer Renderer = new FakeDocumentRenderer();
            public readonly FakeStoragePermission Permission = new FakeStoragePermission();
            public readonly FakeSelectionStore SelectionStore = new FakeSelectionStore();
            public readonly SpyScoreView ScoreView = new SpyScoreView();
            public readonly SpyMetronomeView MetronomeView = new SpyMetronomeView();
            public readonly SpyPickerView PickerView = new SpyPickerView();
            public readonly PracticeController Controller;

            public Harness(params string[] scorePaths)
            {
                Repository.Paths.AddRange(scorePaths);
                Controller = new PracticeController(
                    Metronome, Repository, Renderer, Permission, SelectionStore,
                    ScoreView, MetronomeView, PickerView);
            }
        }

        /// <summary>Creates a harness whose controller has already been initialized.</summary>
        static Harness NewInitializedHarness(params string[] scorePaths)
        {
            var harness = new Harness(scorePaths);
            harness.Controller.Initialize();
            return harness;
        }

        [Test]
        public void If_no_scores_exist_it_should_show_the_guidance_message_on_initialize()
        {
            var harness = NewInitializedHarness();

            StringAssert.Contains("No score found", harness.ScoreView.LastMessage);
            Assert.IsFalse(harness.PickerView.Visible);
        }

        [Test]
        public void If_scores_exist_it_should_show_the_first_page_of_the_first_score()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf", "/a/beta.pdf");

            Assert.AreEqual("/a/alpha.pdf", ((FakePage)harness.ScoreView.LastPage).Path);
            Assert.AreEqual(0, harness.ScoreView.LastPageIndex);
            Assert.AreEqual(2, harness.ScoreView.LastPageCount);
        }

        [Test]
        public void If_the_last_used_score_still_exists_it_should_reopen_it()
        {
            var harness = new Harness("/a/alpha.pdf", "/a/beta.pdf");
            harness.SelectionStore.LastPath = "/a/beta.pdf";

            harness.Controller.Initialize();

            Assert.AreEqual("/a/beta.pdf", ((FakePage)harness.ScoreView.LastPage).Path);
        }

        [Test]
        public void If_the_last_used_score_disappeared_it_should_open_the_first_available_one()
        {
            var harness = new Harness("/a/alpha.pdf");
            harness.SelectionStore.LastPath = "/a/gone.pdf";

            harness.Controller.Initialize();

            Assert.AreEqual("/a/alpha.pdf", ((FakePage)harness.ScoreView.LastPage).Path);
        }

        [Test]
        public void If_a_score_is_loaded_it_should_be_saved_as_the_last_selection()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf");

            Assert.AreEqual("/a/alpha.pdf", harness.SelectionStore.LastPath);
        }

        [Test]
        public void If_rendering_fails_it_should_show_the_renderer_message()
        {
            var harness = new Harness("/a/broken.pdf");
            harness.Renderer.FailingPaths.Add("/a/broken.pdf");

            harness.Controller.Initialize();

            Assert.AreEqual("render failed", harness.ScoreView.LastMessage);
        }

        [Test]
        public void If_menu_is_pressed_it_should_open_the_picker_with_the_current_score_highlighted()
        {
            var harness = new Harness("/a/alpha.pdf", "/a/beta.pdf");
            harness.SelectionStore.LastPath = "/a/beta.pdf";
            harness.Controller.Initialize();

            harness.Controller.OnTogglePicker();

            Assert.IsTrue(harness.PickerView.Visible);
            Assert.AreEqual(new[] { "alpha.pdf", "beta.pdf" }, harness.PickerView.LastFileNames);
            Assert.AreEqual(1, harness.PickerView.LastHighlighted);
        }

        [Test]
        public void If_menu_is_pressed_twice_it_should_close_the_picker()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf");
            harness.Controller.OnTogglePicker();

            harness.Controller.OnTogglePicker();

            Assert.IsFalse(harness.PickerView.Visible);
        }

        [Test]
        public void If_the_picker_is_open_stick_steps_should_move_the_highlight_instead_of_changing_bpm()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf", "/a/beta.pdf", "/a/gamma.pdf");
            var bpmBefore = harness.Metronome.Bpm;
            harness.Controller.OnTogglePicker();

            // Stick down (-1) moves the highlight towards the bottom of the list.
            harness.Controller.OnRightStickStep(-1);

            Assert.AreEqual(1, harness.PickerView.LastHighlighted);
            Assert.AreEqual(bpmBefore, harness.Metronome.Bpm);
        }

        [Test]
        public void If_the_picker_is_closed_stick_steps_should_change_the_bpm_by_five()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf");

            harness.Controller.OnRightStickStep(1);

            Assert.AreEqual(95, harness.Metronome.Bpm);
        }

        [Test]
        public void If_the_picker_is_open_right_primary_should_load_the_highlighted_score_and_close_the_picker()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf", "/a/beta.pdf");
            harness.Controller.OnTogglePicker();
            harness.Controller.OnRightStickStep(-1);

            harness.Controller.OnRightPrimary();

            Assert.IsFalse(harness.PickerView.Visible);
            Assert.AreEqual("/a/beta.pdf", ((FakePage)harness.ScoreView.LastPage).Path);
            Assert.AreEqual("/a/beta.pdf", harness.SelectionStore.LastPath);
        }

        [Test]
        public void If_the_picker_is_open_right_secondary_should_close_it_without_changing_the_score()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf", "/a/beta.pdf");
            harness.Controller.OnTogglePicker();
            harness.Controller.OnRightStickStep(-1);

            harness.Controller.OnRightSecondary();

            Assert.IsFalse(harness.PickerView.Visible);
            Assert.AreEqual("/a/alpha.pdf", ((FakePage)harness.ScoreView.LastPage).Path);
        }

        [Test]
        public void If_the_picker_is_closed_right_primary_should_turn_to_the_next_page()
        {
            var harness = NewInitializedHarness("/a/alpha.pdf");

            harness.Controller.OnRightPrimary();

            Assert.AreEqual(1, harness.ScoreView.LastPageIndex);
        }

        [Test]
        public void If_storage_permission_is_missing_the_picker_should_show_the_grant_prompt()
        {
            var harness = NewInitializedHarness();
            harness.Permission.Granted = false;

            harness.Controller.OnTogglePicker();

            StringAssert.Contains("File access is not granted", harness.PickerView.LastMessage);
        }

        [Test]
        public void If_storage_permission_is_missing_confirming_should_open_the_permission_settings()
        {
            var harness = NewInitializedHarness();
            harness.Permission.Granted = false;
            harness.Controller.OnTogglePicker();

            harness.Controller.OnRightPrimary();

            Assert.AreEqual(1, harness.Permission.OpenSettingsCalls);
            Assert.IsTrue(harness.PickerView.Visible);
        }

        [Test]
        public void If_focus_returns_after_granting_permission_the_open_picker_should_refresh()
        {
            var harness = NewInitializedHarness();
            harness.Permission.Granted = false;
            harness.Controller.OnTogglePicker();

            harness.Permission.Granted = true;
            harness.Repository.Paths.Add("/a/alpha.pdf");
            harness.Controller.OnAppFocusRegained();

            Assert.AreEqual(new[] { "alpha.pdf" }, harness.PickerView.LastFileNames);
        }

        [Test]
        public void If_x_is_pressed_it_should_toggle_the_metronome()
        {
            var harness = NewInitializedHarness();

            harness.Controller.OnToggleMetronome();
            Assert.IsTrue(harness.Metronome.IsRunning);

            harness.Controller.OnToggleMetronome();
            Assert.IsFalse(harness.Metronome.IsRunning);
        }
    }
}
