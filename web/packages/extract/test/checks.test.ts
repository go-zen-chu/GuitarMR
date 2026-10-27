import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type GtsDocument, type Measure, parseTabLine } from "@guitarmr/gts";
import { checkAllTabs, checkDocument, checkStructure, checkTab } from "../src/index.ts";

const load = (name: string): GtsDocument =>
  JSON.parse(readFileSync(new URL(`../../../../schemas/examples/${name}.gts.json`, import.meta.url), "utf8"));

/** A score of plain 4/4 measures m1..mn, with the given fields per measure (1-based). */
function score(n: number, fields: Record<number, Record<string, unknown>> = {}, labels: Record<number, string> = {}): GtsDocument {
  const sections: { label?: string; measures: Measure[] }[] = [];
  for (let i = 1; i <= n; i++) {
    if (labels[i] || i === 1) sections.push(labels[i] ? { label: labels[i], measures: [] } : { measures: [] });
    sections[sections.length - 1]!.measures.push({ id: `m${i}`, ...fields[i] } as Measure);
  }
  return {
    format: "gts",
    version: "0.1",
    meta: { title: "t" },
    source: { file: "t.pdf", pages: [{ index: 0, rotation: 0 }] },
    sections: sections as GtsDocument["sections"],
  };
}

const tab = (line: string) => parseTabLine(line).beats;
const messages = (doc: GtsDocument) => checkStructure(doc).map((i) => `${i.kind} ${i.ids.join(",")}: ${i.message}`);

describe("tab checks", () => {
  const inside = { timeSignature: "4/4", edge: false };
  it("If the beats do not fill the time signature it should say by how much", () => {
    assert.deepEqual(checkTab({ beats: tab("4:1-0 4:1-0 4:1-0 4:1-0") }, inside), []);
    assert.deepEqual(checkTab({ beats: tab("4:1-0 4:1-0 4:1-0 4.:1-0") }, inside), ["拍が多すぎます（4/4 に 4.5 拍）"]);
    assert.deepEqual(checkTab({ beats: tab("4:1-0 8t:1-0 8t:1-0 8t:1-0") }, inside), ["拍が足りません（4/4 に 2 拍）"]);
    assert.deepEqual(checkTab({ beats: tab("4:1-0 2:1-0") }, { timeSignature: "3/4", edge: false }), []);
    assert.deepEqual(checkTab({ beats: tab("8:1-0 8:1-0 4:1-0") }, { timeSignature: "6/8", edge: false }), ["拍が足りません（6/8 に 4 拍）"]);
  });

  it("If the first or last measure is short it should pass as a pickup", () => {
    assert.deepEqual(checkTab({ beats: tab("4:1-0") }, { timeSignature: "4/4", edge: true }), []);
    assert.equal(checkTab({ beats: tab("1:1-0 4:1-0") }, { timeSignature: "4/4", edge: true }).length, 1);
  });

  it("If a chord cannot be played it should be reported", () => {
    assert.deepEqual(checkTab({ beats: tab("1:3-2+3-4") }, inside), ["3弦に音が2つあります"]);
    assert.deepEqual(checkTab({ beats: tab("1:6-1+1-9+3-0") }, inside), ["1〜9 フレットを同時に押さえることになります"]);
    assert.deepEqual(checkTab({ beats: tab("1:6-12+1-17+3-0") }, inside), []);
  });

  it("If a tie does not continue a note on its string it should be reported", () => {
    assert.deepEqual(checkTab({ beats: tab("2:3-2 2:~3-2") }, inside), []);
    assert.deepEqual(checkTab({ beats: tab("2:3-2 2:~2-2") }, inside), ["2つ目の音: 2弦のタイの前に同じ弦の音がありません"]);
    assert.deepEqual(checkTab({ beats: tab("2:~3-4 2:3-4") }, { ...inside, previous: tab("4:3-2")[0]! }), [
      "1つ目の音: 3弦のタイが違うフレット（2 → 4）につながっています",
    ]);
  });

  it("If ties cross a bar line the measure before should count", () => {
    const doc = score(2, { 1: { beats: tab("2:1-0 2:3-2") }, 2: { beats: tab("2:~3-2 2:1-0") } });
    assert.deepEqual([...checkAllTabs(doc)], []);
  });
});

describe("structure checks", () => {
  it("If the samples are checked nothing should be found", () => {
    for (const name of ["sample", "sakura-sakura", "twinkle-twinkle"]) assert.deepEqual(checkDocument(load(name)), [], name);
  });

  it("If repeats do not close they should be reported", () => {
    assert.deepEqual(messages(score(4, { 1: { barStart: "repeat-start" }, 3: { barStart: "repeat-start" }, 4: { barEnd: "repeat-end" } })), [
      "repeat m1,m3: m1 のリピート開始 ‖: が閉じないまま、m3 で次のリピートが始まっています",
    ]);
    assert.deepEqual(messages(score(4, { 3: { barStart: "repeat-start" } })), ["repeat m3: m3 のリピート開始 ‖: が最後まで閉じていません"]);
    // The first :‖ may go back to the beginning; a second one without ‖: is suspect.
    assert.deepEqual(messages(score(4, { 2: { barEnd: "repeat-end" }, 4: { barEnd: "repeat-end" } })), [
      "repeat m4: m4 のリピート終了 :‖ に対応するリピート開始 ‖: がありません（曲の頭に戻ります）",
    ]);
    assert.deepEqual(messages(score(2, { 1: { repeatTimes: 3 } })), ["repeat m1: m1 に演奏回数がありますが、リピート終了 :‖ ではありません"]);
  });

  it("If endings do not follow their repeat they should be reported", () => {
    const ok = { 1: { barStart: "repeat-start" as const }, 3: { volta: [1], barEnd: "repeat-end" as const }, 4: { volta: [2] } };
    assert.deepEqual(messages(score(5, ok)), []);
    assert.deepEqual(messages(score(5, { ...ok, 3: { volta: [1] } })), [
      "repeat m1: m1 のリピート開始 ‖: が最後まで閉じていません",
      "volta m3: 1番カッコの終わり（m3）にリピート終了 :‖ がありません",
      "volta m3,m4: m3 からの番カッコの間にリピート終了 :‖ がありません",
    ]);
    assert.deepEqual(messages(score(5, { ...ok, 4: { volta: [3] } })), [
      "volta m3,m4: m3 からの番カッコの番号が 1 から順に並んでいません（1, 3）",
    ]);
    assert.deepEqual(messages(score(5, { ...ok, 3: { volta: [1, 2], barEnd: "repeat-end" }, 4: { volta: [3] } })), [
      "volta m3: 番カッコは 3 番までありますが、m3 のリピートは 2 回です",
    ]);
    assert.deepEqual(messages(score(5, { ...ok, 3: { volta: [1, 2], barEnd: "repeat-end", repeatTimes: 3 }, 4: { volta: [3] } })), []);
    assert.ok(messages(score(5, ok, { 4: "B" })).includes("section m4: セクション「B」が番カッコの途中から始まっています"));
  });

  it("If D.S., D.C., Coda or Fine lack their partner they should be reported", () => {
    assert.deepEqual(messages(score(3, { 3: { navigation: ["ds"] } })), ["navigation m3: m3 の D.S. で戻る先のセーニョ 𝄋 がありません"]);
    assert.deepEqual(messages(score(3, { 3: { navigation: ["dc-al-coda"] } })), [
      "navigation m3: m3 は al Coda ですが、To Coda がありません",
      "navigation m3: m3 は al Coda ですが、飛ぶ先のコーダ 𝄌 がありません",
    ]);
    assert.deepEqual(messages(score(4, { 1: { navigation: ["coda"] }, 2: { navigation: ["to-coda"] }, 3: { navigation: ["dc-al-coda"] } })), [
      "navigation m1: コーダ 𝄌（m1）が To Coda（m2）より前にあります",
    ]);
    assert.deepEqual(messages(score(3, { 2: { navigation: ["to-coda"] }, 3: { navigation: ["coda"] } })), [
      "navigation m2: m2 に To Coda がありますが、D.S. al Coda / D.C. al Coda がありません",
    ]);
    assert.deepEqual(messages(score(3, { 2: { navigation: ["fine"] } })), ["navigation m2: m2 に Fine がありますが、D.S. / D.C. がありません"]);
    assert.deepEqual(messages(score(3, { 2: { navigation: ["fine"] }, 3: { navigation: ["dc"] } })), []);
  });

  it("If a repeat sign or a section is out of place it should be reported", () => {
    assert.deepEqual(messages(score(3, { 1: { simile: 1 }, 3: { simile: 1, beats: tab("1:1-0") } })), [
      "simile m1: m1 の繰り返し記号の前に、繰り返す 1 小節がありません",
      "simile m3: m3 は繰り返し記号の小節ですが、TAB も書かれています",
    ]);
    assert.deepEqual(messages(score(4, {}, { 3: "B" })), ["section m1: 最初のセクション（m1 から）に名前がありません（ほかは名前付き）"]);
  });

  it("If tab problems are found they should be listed after the structure, by measure", () => {
    const issues = checkDocument(score(3, { 2: { beats: tab("4:1-0") }, 3: { barStart: "repeat-start" } }));
    assert.deepEqual(
      issues.map((i) => [i.kind, i.ids, i.message]),
      [
        ["repeat", ["m3"], "m3 のリピート開始 ‖: が最後まで閉じていません"],
        ["tab", ["m2"], "m2: 拍が足りません（4/4 に 1 拍）"],
      ],
    );
  });
});
