using System;
using System.Collections.Generic;
using System.IO;
using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Renders a PDF file into textures using the Android platform API
    /// (android.graphics.pdf.PdfRenderer) via JNI, so no PDF library or
    /// offline conversion is needed. Returns an explanatory empty result
    /// on platforms without the Android runtime (e.g. the editor).
    /// </summary>
    public sealed class AndroidPdfDocumentRenderer : IScoreDocumentRenderer
    {
        // ParcelFileDescriptor.MODE_READ_ONLY per Android SDK.
        const int ModeReadOnly = 0x10000000;
        // PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY per Android SDK.
        const int RenderModeForDisplay = 1;
        const int TargetPageWidthPixels = 1536;
        const int MaxPages = 60;

        /// <summary>Renders all pages of the given PDF file.</summary>
        public ScoreLoadResult Render(string documentPath)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                if (!File.Exists(documentPath))
                {
                    return new ScoreLoadResult(new List<Texture2D>(), $"File not found:\n{documentPath}");
                }
                var pages = RenderPdf(documentPath);
                return new ScoreLoadResult(pages, $"Loaded {Path.GetFileName(documentPath)}");
            }
            catch (Exception e)
            {
                Debug.LogError($"failed to render PDF {documentPath}: {e}");
                return new ScoreLoadResult(new List<Texture2D>(), $"Failed to render PDF:\n{e.Message}");
            }
#else
            return new ScoreLoadResult(new List<Texture2D>(), "PDF rendering is only available on the Android device.");
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        /// <summary>Renders every page of the PDF at the target width into RGBA32 textures.</summary>
        static List<Texture2D> RenderPdf(string pdfPath)
        {
            var pages = new List<Texture2D>();
            using var file = new AndroidJavaObject("java.io.File", pdfPath);
            using var descriptorClass = new AndroidJavaClass("android.os.ParcelFileDescriptor");
            using var descriptor = descriptorClass.CallStatic<AndroidJavaObject>("open", file, ModeReadOnly);
            using var renderer = new AndroidJavaObject("android.graphics.pdf.PdfRenderer", descriptor);
            var pageCount = Math.Min(renderer.Call<int>("getPageCount"), MaxPages);
            for (var i = 0; i < pageCount; i++)
            {
                pages.Add(RenderPage(renderer, i));
            }
            renderer.Call("close");
            return pages;
        }

        /// <summary>Renders one PDF page into a texture via an Android bitmap.</summary>
        static Texture2D RenderPage(AndroidJavaObject renderer, int pageIndex)
        {
            using var page = renderer.Call<AndroidJavaObject>("openPage", pageIndex);
            var pageWidth = page.Call<int>("getWidth");
            var pageHeight = page.Call<int>("getHeight");
            var width = TargetPageWidthPixels;
            var height = Math.Max(1, (int)((long)width * pageHeight / Math.Max(1, pageWidth)));

            using var configClass = new AndroidJavaClass("android.graphics.Bitmap$Config");
            using var argb8888 = configClass.GetStatic<AndroidJavaObject>("ARGB_8888");
            using var bitmapClass = new AndroidJavaClass("android.graphics.Bitmap");
            using var bitmap = bitmapClass.CallStatic<AndroidJavaObject>("createBitmap", width, height, argb8888);
            // PDF pages have transparent background by default; fill white for readability.
            bitmap.Call("eraseColor", unchecked((int)0xFFFFFFFF));
            // Explicit clip and transform are passed because JNI method resolution
            // cannot match the overload when C# null stands in for Rect/Matrix.
            using var clip = new AndroidJavaObject("android.graphics.Rect", 0, 0, width, height);
            using var transform = new AndroidJavaObject("android.graphics.Matrix");
            transform.Call("setScale", (float)width / pageWidth, (float)height / pageHeight);
            page.Call("render", bitmap, clip, transform, RenderModeForDisplay);
            page.Call("close");

            var pixels = CopyBitmapPixels(bitmap, width, height);
            bitmap.Call("recycle");
            return CreateTexture(pixels, width, height);
        }

        /// <summary>Copies bitmap pixels into a managed byte array in RGBA order.</summary>
        static byte[] CopyBitmapPixels(AndroidJavaObject bitmap, int width, int height)
        {
            using var bufferClass = new AndroidJavaClass("java.nio.ByteBuffer");
            using var buffer = bufferClass.CallStatic<AndroidJavaObject>("allocate", width * height * 4);
            bitmap.Call("copyPixelsToBuffer", buffer);
            return buffer.Call<byte[]>("array");
        }

        /// <summary>Builds a texture from top-down RGBA bytes, flipping rows to Unity's bottom-up order.</summary>
        static Texture2D CreateTexture(byte[] topDownPixels, int width, int height)
        {
            var rowBytes = width * 4;
            var bottomUp = new byte[topDownPixels.Length];
            for (var row = 0; row < height; row++)
            {
                Buffer.BlockCopy(
                    topDownPixels, row * rowBytes,
                    bottomUp, (height - 1 - row) * rowBytes,
                    rowBytes);
            }
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            texture.LoadRawTextureData(bottomUp);
            texture.Apply(false, true);
            return texture;
        }
#endif
    }
}
