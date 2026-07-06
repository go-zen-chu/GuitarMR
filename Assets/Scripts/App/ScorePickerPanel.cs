using System.Collections.Generic;
using System.Text;
using GuitarMR.Usecase;
using UnityEngine;
using UnityEngine.UI;

namespace GuitarMR.App
{
    /// <summary>
    /// World-space panel listing the score PDFs on the device. Shown in front
    /// of the score panel while the picker mode is active; navigation and
    /// selection are controller-driven.
    /// </summary>
    public sealed class ScorePickerPanel : IScorePickerView
    {
        const float CanvasWidth = 900f;
        const float CanvasHeight = 1000f;
        const float MetersPerPixel = 0.0006f;
        const int MaxVisibleItems = 12;
        const string HighlightColor = "#FFB347";
        const string NormalColor = "#FFFFFFB4";

        readonly GameObject root;
        readonly Text listText;

        /// <summary>Builds the (initially hidden) panel hierarchy under the given parent transform.</summary>
        public ScorePickerPanel(Transform parent)
        {
            var canvas = UiFactory.CreateWorldCanvas(
                "ScorePickerPanel", parent, new Vector2(CanvasWidth, CanvasHeight), MetersPerPixel);
            root = canvas.gameObject;
            // Slightly in front of the score panel so the list is never z-fighting with it.
            canvas.transform.localPosition = new Vector3(0f, 0.12f, -0.03f);

            var background = UiFactory.CreateImage("Background", canvas.transform, new Color(0.05f, 0.05f, 0.1f, 0.92f));
            UiFactory.ApplyAnchors(background.rectTransform, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);

            var title = UiFactory.CreateText("Title", canvas.transform, 44, TextAnchor.MiddleCenter, Color.white);
            title.text = "SELECT SCORE";
            UiFactory.ApplyAnchors(title.rectTransform, new Vector2(0f, 1f), Vector2.one,
                new Vector2(10f, -80f), new Vector2(-10f, -16f));

            listText = UiFactory.CreateText("List", canvas.transform, 32, TextAnchor.UpperLeft, Color.white);
            listText.supportRichText = true;
            UiFactory.ApplyAnchors(listText.rectTransform, Vector2.zero, Vector2.one,
                new Vector2(40f, 70f), new Vector2(-40f, -90f));

            var hint = UiFactory.CreateText("Hint", canvas.transform, 26, TextAnchor.MiddleCenter,
                new Color(1f, 1f, 1f, 0.7f));
            hint.text = "R-stick: move   A: load   B / Menu: close";
            UiFactory.ApplyAnchors(hint.rectTransform, Vector2.zero, new Vector2(1f, 0f),
                new Vector2(10f, 10f), new Vector2(-10f, 56f));

            root.SetActive(false);
        }

        /// <summary>Shows the score file names with one entry highlighted, windowed around the highlight.</summary>
        public void ShowScores(IReadOnlyList<string> fileNames, int highlightedIndex)
        {
            root.SetActive(true);
            listText.text = BuildListText(fileNames, highlightedIndex);
        }

        /// <summary>Shows a message inside the picker (no files, missing permission).</summary>
        public void ShowMessage(string message)
        {
            root.SetActive(true);
            listText.text = message;
        }

        /// <summary>Hides the picker.</summary>
        public void Hide()
        {
            root.SetActive(false);
        }

        /// <summary>Builds the rich-text list windowed to the visible item count.</summary>
        static string BuildListText(IReadOnlyList<string> fileNames, int highlightedIndex)
        {
            var windowStart = Mathf.Clamp(
                highlightedIndex - MaxVisibleItems / 2, 0, Mathf.Max(0, fileNames.Count - MaxVisibleItems));
            var windowEnd = Mathf.Min(fileNames.Count, windowStart + MaxVisibleItems);

            var builder = new StringBuilder();
            if (windowStart > 0)
            {
                builder.AppendLine($"<color={NormalColor}>  ... {windowStart} more</color>");
            }
            for (var i = windowStart; i < windowEnd; i++)
            {
                var name = Sanitize(fileNames[i]);
                builder.AppendLine(i == highlightedIndex
                    ? $"<color={HighlightColor}>> {name}</color>"
                    : $"<color={NormalColor}>  {name}</color>");
            }
            if (windowEnd < fileNames.Count)
            {
                builder.AppendLine($"<color={NormalColor}>  ... {fileNames.Count - windowEnd} more</color>");
            }
            return builder.ToString();
        }

        /// <summary>Strips characters that the UI rich-text parser would treat as markup.</summary>
        static string Sanitize(string fileName)
        {
            return fileName.Replace('<', '(').Replace('>', ')');
        }
    }
}
