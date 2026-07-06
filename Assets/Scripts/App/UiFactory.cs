using UnityEngine;
using UnityEngine.UI;

namespace GuitarMR.App
{
    /// <summary>Helpers for building the world-space UI panels from code, without prefabs.</summary>
    public static class UiFactory
    {
        /// <summary>Creates a world-space canvas of the given pixel size scaled to meters.</summary>
        public static Canvas CreateWorldCanvas(string name, Transform parent, Vector2 sizePixels, float metersPerPixel)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var rect = canvas.GetComponent<RectTransform>();
            rect.sizeDelta = sizePixels;
            rect.localScale = Vector3.one * metersPerPixel;
            return canvas;
        }

        /// <summary>Creates a rect-transform child object under the given parent.</summary>
        public static RectTransform CreateUiObject(string name, Transform parent)
        {
            var go = new GameObject(name);
            var rect = go.AddComponent<RectTransform>();
            rect.SetParent(parent, false);
            return rect;
        }

        /// <summary>Creates a solid color image filling the area set by ApplyAnchors.</summary>
        public static Image CreateImage(string name, Transform parent, Color color)
        {
            var rect = CreateUiObject(name, parent);
            var image = rect.gameObject.AddComponent<Image>();
            image.color = color;
            return image;
        }

        /// <summary>Creates a raw image for displaying dynamically generated textures.</summary>
        public static RawImage CreateRawImage(string name, Transform parent)
        {
            var rect = CreateUiObject(name, parent);
            return rect.gameObject.AddComponent<RawImage>();
        }

        /// <summary>Creates a text element using the engine's built-in font.</summary>
        public static Text CreateText(string name, Transform parent, int fontSize, TextAnchor alignment, Color color)
        {
            var rect = CreateUiObject(name, parent);
            var text = rect.gameObject.AddComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = fontSize;
            text.alignment = alignment;
            text.color = color;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Overflow;
            return text;
        }

        /// <summary>Anchors a rect transform relative to its parent with pixel offsets.</summary>
        public static void ApplyAnchors(RectTransform rect, Vector2 anchorMin, Vector2 anchorMax, Vector2 offsetMin, Vector2 offsetMax)
        {
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
        }
    }
}
