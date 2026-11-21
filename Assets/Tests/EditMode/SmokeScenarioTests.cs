using System.Collections.Generic;
using System.Linq;
using GuitarMR.Smoke;
using GuitarMR.Usecase;
using NUnit.Framework;

namespace GuitarMR.Tests
{
    /// <summary>
    /// BDD-style tests for the on-device smoke check, run against the real
    /// <see cref="PracticeController"/> with in-memory ports, so the verdicts the
    /// device script relies on are pinned down without a headset.
    /// </summary>
    public sealed class SmokeScenarioTests
    {
        const string Target = "guitarmr-smoke.pdf";

        sealed class Page : IScorePage
        {
        }

        sealed class StubMetronome : IMetronome
        {
            public bool IsRunning { get; private set; }
            public int Bpm { get; private set; } = 90;
            public int BeatsPerBar => 4;
            public int CurrentBeatInBar => -1;

            public void StartTicking() => IsRunning = true;

            public void StopTicking() => IsRunning = false;

            public void SetBpm(int bpm) => Bpm = bpm;
        }

        sealed class StubRepository : IScoreRepository
        {
            public List<string> Paths = new List<string>();

            public IReadOnlyList<string> ListScorePaths() => Paths.ToList();
        }

        sealed class StubRenderer : IScoreDocumentRenderer
        {
            public int PageCount = 2;

            public ScoreLoadResult Render(string documentPath) => PageCount == 0
                ? new ScoreLoadResult(new List<IScorePage>(), "render failed")
                : new ScoreLoadResult(Enumerable.Range(0, PageCount).Select(_ => (IScorePage)new Page()).ToList(), "");
        }

        sealed class StubPermission : IStoragePermission
        {
            public bool Granted = true;

            public bool IsGranted => Granted;

            public void OpenPermissionSettings()
            {
            }
        }

        sealed class MemorySelectionStore : IScoreSelectionStore
        {
            public string LastPath;

            public string LoadLastScorePath() => LastPath;

            public void SaveLastScorePath(string path) => LastPath = path;
        }

        sealed class NullScoreView : IScoreView
        {
            public void ShowPage(IScorePage page, int pageIndex, int pageCount)
            {
            }

            public void ShowMessage(string message)
            {
            }
        }

        sealed class NullMetronomeView : IMetronomeView
        {
            public void ShowState(int bpm, bool isRunning, int beatInBar, int beatsPerBar)
            {
            }
        }

        sealed class NullPickerView : IScorePickerView
        {
            public void ShowScores(IReadOnlyList<string> fileNames, int highlightedIndex)
            {
            }

            public void ShowMessage(string message)
            {
            }

            public void Hide()
            {
            }
        }

        /// <summary>Wires the scenario into a practice controller the same way the composition root does.</summary>
        sealed class Harness
        {
            public readonly StubRepository Repository = new StubRepository();
            public readonly StubRenderer Renderer = new StubRenderer();
            public readonly StubPermission Permission = new StubPermission();
            public readonly MemorySelectionStore SelectionStore = new MemorySelectionStore();
            public readonly List<string> Lines = new List<string>();
            public bool PanelsBuilt = true;

            /// <summary>Builds the controller and scenario, initializes the session and runs the checks.</summary>
            public bool Run()
            {
                var scenario = new SmokeScenario(
                    new NullScoreView(), new NullPickerView(), Permission, () => PanelsBuilt, Target, Lines.Add);
                var controller = new PracticeController(
                    new StubMetronome(), Repository, Renderer, Permission, SelectionStore,
                    scenario.ScoreView, new NullMetronomeView(), scenario.PickerView);
                scenario.Input.RightPrimaryPressed += controller.OnRightPrimary;
                scenario.Input.RightSecondaryPressed += controller.OnRightSecondary;
                scenario.Input.RightStickStepped += controller.OnRightStickStep;
                scenario.Input.LeftMenuPressed += controller.OnTogglePicker;
                controller.Initialize();
                return scenario.Run();
            }

            public string LastLine => Lines.Last();

            /// <summary>Returns the FAIL line, or null when every check passed.</summary>
            public string FailureLine => Lines.FirstOrDefault(l => l.Contains(" FAIL "));
        }

        /// <summary>Creates a harness whose library holds the given score file names under one folder.</summary>
        static Harness NewHarness(params string[] fileNames)
        {
            var harness = new Harness();
            harness.Repository.Paths.AddRange(fileNames.Select(n => "/sdcard/Download/" + n));
            return harness;
        }

        [Test]
        public void If_the_target_score_has_two_pages_it_should_pass_every_check()
        {
            var harness = NewHarness("a.pdf", "b.pdf", Target, "z.pdf");

            Assert.IsTrue(harness.Run());
            Assert.IsNull(harness.FailureLine);
            Assert.AreEqual("GuitarMR smoke: RESULT PASS", harness.LastLine);
            CollectionAssert.Contains(harness.Lines, "GuitarMR smoke: PASS page turn");
        }

        [Test]
        public void If_another_score_was_opened_last_it_should_still_pick_the_target()
        {
            var harness = NewHarness("a.pdf", Target, "z.pdf");
            harness.SelectionStore.LastPath = "/sdcard/Download/z.pdf";

            Assert.IsTrue(harness.Run());
            Assert.AreEqual("/sdcard/Download/" + Target, harness.SelectionStore.LastPath);
        }

        [Test]
        public void If_the_target_score_is_missing_it_should_fail_at_the_picker()
        {
            var harness = NewHarness("a.pdf");

            Assert.IsFalse(harness.Run());
            StringAssert.StartsWith("GuitarMR smoke: FAIL picker lists score", harness.FailureLine);
            Assert.AreEqual("GuitarMR smoke: RESULT FAIL", harness.LastLine);
        }

        [Test]
        public void If_storage_access_is_not_granted_it_should_fail_before_opening_the_picker()
        {
            var harness = NewHarness(Target);
            harness.Permission.Granted = false;

            Assert.IsFalse(harness.Run());
            StringAssert.StartsWith("GuitarMR smoke: FAIL storage permission", harness.FailureLine);
        }

        [Test]
        public void If_the_panels_were_not_built_it_should_fail_the_panel_check()
        {
            var harness = NewHarness(Target);
            harness.PanelsBuilt = false;

            Assert.IsFalse(harness.Run());
            StringAssert.StartsWith("GuitarMR smoke: FAIL panels", harness.FailureLine);
        }

        [Test]
        public void If_the_score_cannot_be_rendered_it_should_fail_the_render_check()
        {
            var harness = NewHarness(Target);
            harness.Renderer.PageCount = 0;

            Assert.IsFalse(harness.Run());
            StringAssert.StartsWith("GuitarMR smoke: FAIL pdf render: no page was shown: render failed", harness.FailureLine);
        }

        [Test]
        public void If_the_score_has_a_single_page_it_should_fail_the_render_check()
        {
            var harness = NewHarness(Target);
            harness.Renderer.PageCount = 1;

            Assert.IsFalse(harness.Run());
            StringAssert.StartsWith("GuitarMR smoke: FAIL pdf render: expected at least 2 pages", harness.FailureLine);
        }
    }
}
