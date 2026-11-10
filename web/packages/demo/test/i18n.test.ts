import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MESSAGES, PAGE_EN, pickLang } from "../src/i18n.ts";

const page = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
/** The keys page.html asks for, from data-i18n, data-i18n-html and data-i18n-<attribute>. */
const pageKeys = new Set([...page.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]!));

describe("pickLang", () => {
  it("If the device prefers Japanese it should be Japanese, and English otherwise", () => {
    assert.equal(pickLang(["ja-JP", "en-US"]), "ja");
    assert.equal(pickLang(["ja"]), "ja");
    assert.equal(pickLang(["en-GB", "ja"]), "en");
    assert.equal(pickLang(["fr-FR", "ja-JP"]), "ja");
    assert.equal(pickLang(["fr-FR", "de"]), "en");
    assert.equal(pickLang([]), "en");
  });
});

describe("PAGE_EN", () => {
  it("If page.html marks text for translation it should have English for it, and no unused entries", () => {
    assert.ok(pageKeys.size > 50, `${pageKeys.size} keys`);
    assert.deepEqual([...pageKeys].filter((k) => !(k in PAGE_EN)), []);
    assert.deepEqual(Object.keys(PAGE_EN).filter((k) => !pageKeys.has(k)), []);
  });

  it("If an element is marked it should not be left in Japanese in English", () => {
    const japanese = /[ぁ-んァ-ン一-龥]/;
    assert.deepEqual(Object.entries(PAGE_EN).filter(([, v]) => japanese.test(v)), []);
  });
});

describe("MESSAGES", () => {
  it("If a text is shown in English it should not be Japanese, for every message", () => {
    const japanese = /[ぁ-んァ-ン一-龥]/;
    const leaks: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (typeof value === "string" && japanese.test(value)) leaks.push(path);
      else if (typeof value === "function") {
        const call = value as (...a: unknown[]) => unknown;
        // Parameters are numbers or names, except the lists some messages join.
        let shown: unknown;
        try {
          shown = call(1, 2, 3, true);
        } catch {
          shown = call(["x"], 2);
        }
        if (typeof shown === "string" && japanese.test(shown)) leaks.push(path);
      } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
    };
    visit(MESSAGES.en, "en");
    assert.deepEqual(leaks, []);
  });

  it("If a progression or scale is named it should be named in both languages", () => {
    for (const lang of ["ja", "en"] as const) {
      for (const id of ["canon", "royal-road", "komuro", "two-five-one", "cadence", "dominant-motion", "secondary-dominant", "two-five", "plagal", "sus4"]) {
        assert.ok(MESSAGES[lang].progressions[id]?.name, `${lang} ${id}`);
      }
      assert.equal(Object.keys(MESSAGES[lang].scales).length, 15);
    }
  });
});
