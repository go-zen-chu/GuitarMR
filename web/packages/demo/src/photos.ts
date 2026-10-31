/**
 * Photos as input: one photo per page. Photos are collected in a tray
 * (taken one by one with the camera, or several picked at once) and
 * analyzed together as one score; the worker then cuts the white sheet out
 * of each photo and fixes its perspective and lighting (correctPhoto in
 * @guitarmr/layoutscan) before detection.
 */

import type { RgbaImage } from "@guitarmr/layoutscan";

/** Photos are decoded at most this large on the long side (12 MP phone photos fit). */
export const PHOTO_MAX_SIDE = 4032;

export interface PhotoFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** JPEG, PNG, WebP, GIF, HEIC/HEIF/AVIF, by their first bytes (picked files may have no type). */
export function isImage(bytes: Uint8Array, type = ""): boolean {
  if (type.startsWith("image/")) return true;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    ascii(0, 8) === "\x89PNG\r\n\x1a\n" ||
    (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") ||
    ascii(0, 4) === "GIF8" ||
    (ascii(4, 8) === "ftyp" && /^(hei[cxsm]|hev[cx]|mif1|msf1|avif)$/.test(ascii(8, 12)))
  );
}

/** Decode a photo to RGBA pixels, upright by its EXIF orientation. */
export async function decodePhoto(photo: PhotoFile, maxSide = PHOTO_MAX_SIDE): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(new Blob([photo.bytes as Uint8Array<ArrayBuffer>], { type: photo.type }), {
    imageOrientation: "from-image",
  });
  const scale = Math.min(maxSide / Math.max(bitmap.width, bitmap.height), 1);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, width, height);
  canvas.width = 0; // release the canvas memory now (iOS caps the total)
  return { width, height, data };
}

/** All photos' bytes in page order: what the score's sha256 is taken over. */
export function concatPhotos(photos: PhotoFile[]): Uint8Array {
  const out = new Uint8Array(photos.reduce((n, p) => n + p.bytes.length, 0));
  let offset = 0;
  for (const p of photos) {
    out.set(p.bytes, offset);
    offset += p.bytes.length;
  }
  return out;
}

export interface TrayHost {
  /** Analyze these photos as the pages of one score. */
  analyze(photos: PhotoFile[]): void;
}

export function createTray(host: TrayHost) {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const t = {
    tray: $<HTMLElement>("tray"),
    list: $<HTMLOListElement>("tray-list"),
    go: $<HTMLButtonElement>("tray-go"),
    clear: $<HTMLButtonElement>("tray-clear"),
  };
  let photos: { photo: PhotoFile; url: string }[] = [];

  function render() {
    t.tray.hidden = photos.length === 0;
    t.go.textContent = `この ${photos.length} 枚で解析する`;
    t.list.replaceChildren(
      ...photos.map(({ photo, url }, i) => {
        const li = document.createElement("li");
        const img = document.createElement("img");
        img.src = url;
        img.alt = `p${i + 1}: ${photo.name}`;
        const label = document.createElement("span");
        label.textContent = `p${i + 1}`;
        const actions = document.createElement("div");
        const earlier = document.createElement("button");
        earlier.type = "button";
        earlier.textContent = "←";
        earlier.setAttribute("aria-label", `p${i + 1} を前へ`);
        earlier.disabled = i === 0;
        earlier.addEventListener("click", () => {
          [photos[i - 1], photos[i]] = [photos[i]!, photos[i - 1]!];
          render();
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `p${i + 1} を外す`);
        remove.addEventListener("click", () => {
          URL.revokeObjectURL(photos[i]!.url);
          photos.splice(i, 1);
          render();
        });
        actions.append(earlier, remove);
        li.append(img, label, actions);
        return li;
      }),
    );
  }

  function clear() {
    for (const p of photos) URL.revokeObjectURL(p.url);
    photos = [];
    render();
  }

  t.go.addEventListener("click", () => {
    const picked = photos.map((p) => p.photo);
    clear();
    if (picked.length) host.analyze(picked);
  });
  t.clear.addEventListener("click", clear);

  return {
    /** Add photos as the next pages, then show the tray. */
    add(added: PhotoFile[]) {
      for (const photo of added) {
        photos.push({ photo, url: URL.createObjectURL(new Blob([photo.bytes as Uint8Array<ArrayBuffer>], { type: photo.type })) });
      }
      render();
      t.tray.scrollIntoView({ block: "nearest" });
    },
    clear,
  };
}
