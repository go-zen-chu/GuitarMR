using System;
using System.Linq;
using GuitarMR.Usecase;

namespace GuitarMR.Smoke
{
    /// <summary>
    /// Scripted smoke check of the practice flow on the device: the panels exist,
    /// storage access is granted, the picker lists the target score, picking it
    /// renders its pages, and A/B turn them. It drives the app through
    /// <see cref="Input"/> and observes it through the recording views, which the
    /// composition root passes to the <see cref="PracticeController"/> in place of
    /// the real ones. Each check writes "GuitarMR smoke: PASS|FAIL &lt;check&gt;" and the
    /// run ends with "GuitarMR smoke: RESULT PASS|FAIL", the line
    /// scripts/run-device-tests.sh waits for in logcat.
    /// </summary>
    public sealed class SmokeScenario
    {
        public const string LinePrefix = "GuitarMR smoke:";

        readonly RecordingScoreView scoreView;
        readonly RecordingScorePickerView pickerView;
        readonly ScriptedControllerInput input = new ScriptedControllerInput();
        readonly IStoragePermission storagePermission;
        readonly Func<bool> panelsBuilt;
        readonly string targetScoreName;
        readonly Action<string> writeLine;

        public IControllerInput Input => input;
        public IScoreView ScoreView => scoreView;
        public IScorePickerView PickerView => pickerView;

        /// <summary>
        /// Creates the scenario around the real views. <paramref name="panelsBuilt"/> reports
        /// whether the panels exist in the scene; <paramref name="targetScoreName"/> is the
        /// file name of a PDF with at least two pages in the scanned folders.
        /// </summary>
        public SmokeScenario(
            IScoreView scoreView,
            IScorePickerView pickerView,
            IStoragePermission storagePermission,
            Func<bool> panelsBuilt,
            string targetScoreName,
            Action<string> writeLine)
        {
            if (string.IsNullOrEmpty(targetScoreName))
            {
                throw new ArgumentException("a target score file name is required", nameof(targetScoreName));
            }
            this.scoreView = new RecordingScoreView(scoreView);
            this.pickerView = new RecordingScorePickerView(pickerView);
            this.storagePermission = storagePermission ?? throw new ArgumentNullException(nameof(storagePermission));
            this.panelsBuilt = panelsBuilt ?? throw new ArgumentNullException(nameof(panelsBuilt));
            this.targetScoreName = targetScoreName;
            this.writeLine = writeLine ?? throw new ArgumentNullException(nameof(writeLine));
        }

        /// <summary>Runs the checks in order, stopping at the first failure, and returns whether all passed.</summary>
        public bool Run()
        {
            var passed = Check("launch", () => null)
                && Check("panels", CheckPanels)
                && Check("storage permission", CheckStoragePermission)
                && Check("picker lists score", HighlightTargetInPicker)
                && Check("pdf render", LoadHighlightedScore)
                && Check("page turn", TurnPages);
            writeLine($"{LinePrefix} RESULT {(passed ? "PASS" : "FAIL")}");
            return passed;
        }

        /// <summary>Runs one check, which returns null on success or the reason it failed, and logs the outcome.</summary>
        bool Check(string name, Func<string> check)
        {
            string failure;
            try
            {
                failure = check();
            }
            catch (Exception e)
            {
                failure = $"{e.GetType().Name}: {e.Message}";
            }
            writeLine(failure == null ? $"{LinePrefix} PASS {name}" : $"{LinePrefix} FAIL {name}: {failure}");
            return failure == null;
        }

        /// <summary>Expects the panels to exist in the scene.</summary>
        string CheckPanels() => panelsBuilt() ? null : "the score, metronome and picker panels were not built";

        /// <summary>Expects all files access, which the picker needs to list shared storage.</summary>
        string CheckStoragePermission() => storagePermission.IsGranted
            ? null
            : "all files access is not granted (adb shell appops set <package> MANAGE_EXTERNAL_STORAGE allow)";

        /// <summary>Opens the picker and moves the highlight onto the target score.</summary>
        string HighlightTargetInPicker()
        {
            if (pickerView.IsVisible)
            {
                input.PressLeftMenu();
            }
            input.PressLeftMenu();
            if (!pickerView.IsVisible)
            {
                return "Menu did not open the picker";
            }
            var target = pickerView.FileNames.ToList().IndexOf(targetScoreName);
            if (target < 0)
            {
                return pickerView.FileNames.Count == 0
                    ? $"the picker lists no scores: {pickerView.LastMessage}"
                    : $"{targetScoreName} is not listed: {string.Join(", ", pickerView.FileNames)}";
            }
            for (var steps = 0; pickerView.Highlighted != target && steps < pickerView.FileNames.Count; steps++)
            {
                // Stick up (+1) moves the highlight towards the top of the list.
                input.StepRightStick(pickerView.Highlighted > target ? 1 : -1);
            }
            return pickerView.Highlighted == target
                ? null
                : $"the highlight stopped at {pickerView.Highlighted}, not at {target}";
        }

        /// <summary>Confirms the highlighted score and expects its first page on display.</summary>
        string LoadHighlightedScore()
        {
            var shownBefore = scoreView.ShownPageCount;
            input.PressRightPrimary();
            if (pickerView.IsVisible)
            {
                return "A did not close the picker";
            }
            if (scoreView.ShownPageCount == shownBefore || scoreView.PageIndex != 0)
            {
                return $"no page was shown: {scoreView.LastMessage}";
            }
            return scoreView.PageCount >= 2 ? null : $"expected at least 2 pages, got {scoreView.PageCount}";
        }

        /// <summary>Turns to the next page with A and back with B.</summary>
        string TurnPages()
        {
            input.PressRightPrimary();
            if (scoreView.PageIndex != 1)
            {
                return $"A showed page index {scoreView.PageIndex}, expected 1";
            }
            input.PressRightSecondary();
            return scoreView.PageIndex == 0 ? null : $"B showed page index {scoreView.PageIndex}, expected 0";
        }
    }
}
