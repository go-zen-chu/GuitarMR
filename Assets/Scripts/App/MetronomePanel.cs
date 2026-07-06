using GuitarMR.Usecase;
using UnityEngine;
using UnityEngine.UI;

namespace GuitarMR.App
{
    /// <summary>
    /// World-space panel that shows the metronome tempo, running state,
    /// a beat indicator per beat of the bar, and a controls hint.
    /// </summary>
    public sealed class MetronomePanel : IMetronomeView
    {
        const float CanvasWidth = 900f;
        const float CanvasHeight = 260f;
        const float MetersPerPixel = 0.0006f;
        const float DotSize = 56f;
        const float DotSpacing = 76f;

        static readonly Color InactiveDotColor = new Color(1f, 1f, 1f, 0.25f);
        static readonly Color BeatDotColor = new Color(1f, 0.62f, 0.11f, 1f);
        static readonly Color AccentDotColor = new Color(1f, 0.27f, 0.23f, 1f);

        readonly Text bpmText;
        readonly Text stateText;
        readonly Image[] beatDots;

        int lastBpm = -1;
        bool lastRunning;
        int lastBeatInBar = int.MinValue;

        /// <summary>Builds the panel hierarchy under the given parent transform.</summary>
        public MetronomePanel(Transform parent, int beatsPerBar)
        {
            var canvas = UiFactory.CreateWorldCanvas(
                "MetronomePanel", parent, new Vector2(CanvasWidth, CanvasHeight), MetersPerPixel);
            canvas.transform.localPosition = new Vector3(0f, -0.36f, 0f);

            var background = UiFactory.CreateImage("Background", canvas.transform, new Color(0f, 0f, 0f, 0.55f));
            UiFactory.ApplyAnchors(background.rectTransform, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);

            bpmText = UiFactory.CreateText("BpmText", canvas.transform, 64, TextAnchor.MiddleLeft, Color.white);
            UiFactory.ApplyAnchors(bpmText.rectTransform, new Vector2(0f, 0.5f), new Vector2(0.4f, 1f),
                new Vector2(30f, 0f), new Vector2(0f, -10f));

            stateText = UiFactory.CreateText("StateText", canvas.transform, 40, TextAnchor.MiddleRight, Color.white);
            UiFactory.ApplyAnchors(stateText.rectTransform, new Vector2(0.6f, 0.5f), new Vector2(1f, 1f),
                new Vector2(0f, 0f), new Vector2(-30f, -10f));

            beatDots = CreateBeatDots(canvas.transform, beatsPerBar);

            var hintText = UiFactory.CreateText("HintText", canvas.transform, 24, TextAnchor.MiddleCenter,
                new Color(1f, 1f, 1f, 0.7f));
            hintText.text = "A: next   B: prev   X: start/stop   Y: recenter   R-stick: BPM   Menu: scores";
            UiFactory.ApplyAnchors(hintText.rectTransform, Vector2.zero, new Vector2(1f, 0f),
                new Vector2(10f, 8f), new Vector2(-10f, 44f));
        }

        /// <summary>Shows the tempo, running state and highlighted beat, updating only on change.</summary>
        public void ShowState(int bpm, bool isRunning, int beatInBar, int beatsPerBar)
        {
            if (bpm == lastBpm && isRunning == lastRunning && beatInBar == lastBeatInBar)
            {
                return;
            }
            lastBpm = bpm;
            lastRunning = isRunning;
            lastBeatInBar = beatInBar;

            bpmText.text = $"BPM {bpm}";
            stateText.text = isRunning ? "RUNNING" : "STOPPED";
            for (var i = 0; i < beatDots.Length; i++)
            {
                var isCurrent = isRunning && i == beatInBar;
                beatDots[i].color = !isCurrent ? InactiveDotColor
                    : i == 0 ? AccentDotColor
                    : BeatDotColor;
            }
        }

        /// <summary>Creates the centered row of beat indicator squares.</summary>
        static Image[] CreateBeatDots(Transform parent, int beatsPerBar)
        {
            var dots = new Image[beatsPerBar];
            var rowWidth = (beatsPerBar - 1) * DotSpacing;
            for (var i = 0; i < beatsPerBar; i++)
            {
                var dot = UiFactory.CreateImage($"BeatDot{i}", parent, InactiveDotColor);
                var rect = dot.rectTransform;
                rect.anchorMin = rect.anchorMax = new Vector2(0.5f, 0.62f);
                rect.sizeDelta = new Vector2(DotSize, DotSize);
                rect.anchoredPosition = new Vector2(i * DotSpacing - rowWidth / 2f, 0f);
                dots[i] = dot;
            }
            return dots;
        }
    }
}
