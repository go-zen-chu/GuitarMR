using GuitarMR.Infra;
using GuitarMR.Usecase;
using UnityEngine;
using UnityEngine.UI;

namespace GuitarMR.App
{
    /// <summary>
    /// World-space panel that displays one score page with a page counter,
    /// or an instruction message when no score is loaded.
    /// </summary>
    public sealed class ScorePanel : IScoreView
    {
        const float CanvasWidth = 900f;
        const float CanvasHeight = 1200f;
        const float MetersPerPixel = 0.0006f;
        const float FooterHeight = 70f;

        readonly RawImage pageImage;
        readonly AspectRatioFitter aspectFitter;
        readonly Text pageLabel;
        readonly Text messageText;

        /// <summary>Builds the panel hierarchy under the given parent transform.</summary>
        public ScorePanel(Transform parent)
        {
            var canvas = UiFactory.CreateWorldCanvas(
                "ScorePanel", parent, new Vector2(CanvasWidth, CanvasHeight), MetersPerPixel);
            canvas.transform.localPosition = new Vector3(0f, 0.12f, 0f);

            var background = UiFactory.CreateImage("Background", canvas.transform, new Color(0f, 0f, 0f, 0.55f));
            UiFactory.ApplyAnchors(background.rectTransform, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);

            var pageArea = UiFactory.CreateUiObject("PageArea", canvas.transform);
            UiFactory.ApplyAnchors(pageArea, Vector2.zero, Vector2.one,
                new Vector2(10f, FooterHeight), new Vector2(-10f, -10f));

            pageImage = UiFactory.CreateRawImage("Page", pageArea);
            UiFactory.ApplyAnchors(pageImage.rectTransform, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            aspectFitter = pageImage.gameObject.AddComponent<AspectRatioFitter>();
            aspectFitter.aspectMode = AspectRatioFitter.AspectMode.FitInParent;

            messageText = UiFactory.CreateText("Message", pageArea, 34, TextAnchor.MiddleCenter, Color.white);
            UiFactory.ApplyAnchors(messageText.rectTransform, Vector2.zero, Vector2.one,
                new Vector2(40f, 40f), new Vector2(-40f, -40f));

            pageLabel = UiFactory.CreateText("PageLabel", canvas.transform, 32, TextAnchor.MiddleCenter, Color.white);
            UiFactory.ApplyAnchors(pageLabel.rectTransform, Vector2.zero, new Vector2(1f, 0f),
                new Vector2(10f, 10f), new Vector2(-10f, FooterHeight - 10f));

            ShowMessage("Loading score...");
        }

        /// <summary>Shows one rendered score page with paging information.</summary>
        public void ShowPage(IScorePage page, int pageIndex, int pageCount)
        {
            if (!(page is TextureScorePage texturePage))
            {
                ShowMessage($"Unsupported score page type: {page?.GetType().Name ?? "null"}");
                return;
            }
            messageText.gameObject.SetActive(false);
            pageImage.gameObject.SetActive(true);
            pageImage.texture = texturePage.Texture;
            aspectFitter.aspectRatio = (float)texturePage.Texture.width / texturePage.Texture.height;
            pageLabel.text = $"Page {pageIndex + 1} / {pageCount}";
        }

        /// <summary>Shows a status message instead of a page.</summary>
        public void ShowMessage(string message)
        {
            pageImage.gameObject.SetActive(false);
            messageText.gameObject.SetActive(true);
            messageText.text = message;
            pageLabel.text = string.Empty;
        }
    }
}
