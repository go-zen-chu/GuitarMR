/**
 * The page in Japanese or English, after the device's language. The
 * markup in page.html is written in Japanese; for English, each element
 * marked with data-i18n (its text), data-i18n-html (its markup) or
 * data-i18n-<attribute> takes the entry of that key from PAGE_EN. Text
 * made at run time comes from MESSAGES, handed to each module that shows it.
 */

import type { ChordFunction, RelatedKeys, SubstituteKind } from "@guitarmr/gts";

export type Lang = "ja" | "en";

/** Japanese when the device prefers it, English for every other language. */
export function pickLang(languages: readonly string[]): Lang {
  const first = languages.find((l) => /^(ja|en)\b/i.test(l));
  return first?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** Attributes that can be translated with data-i18n-<attribute>. */
const ATTRIBUTES = ["aria-label", "placeholder", "title", "alt"] as const;

/**
 * Put the page in `lang`. Japanese is what the markup says already. An
 * element with child elements keeps them: only its first text is replaced.
 */
export function localizePage(root: Document, lang: Lang): void {
  root.documentElement.lang = lang;
  if (lang === "ja") return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const text = PAGE_EN[el.dataset.i18n!];
    if (text === undefined) continue;
    const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    if (el.children.length && node) node.textContent = text;
    else if (!el.children.length) el.textContent = text;
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-html]")) {
    const html = PAGE_EN[el.dataset.i18nHtml!];
    // Trusted: the entries are constants of this file.
    if (html !== undefined) el.innerHTML = html;
  }
  for (const attribute of ATTRIBUTES) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      const text = PAGE_EN[el.getAttribute(`data-i18n-${attribute}`)!];
      if (text !== undefined) el.setAttribute(attribute, text);
    }
  }
}

/** English for the keys used in page.html. */
export const PAGE_EN: Record<string, string> = {
  settings: "Settings",
  scores: "Scores",
  libraryEmpty: 'Nothing yet. Open a PDF or photos in <a href="#/scan">Scan</a> and the scores read appear here.',
  libraryUnavailable:
    'This screen cannot keep scores on the device. Save a score opened in <a href="#/scan">Scan</a> as gts.json when you are done.',
  scannedScores: "Scanned scores",
  sampleSongs: "Sample songs",
  sampleNote:
    "Public-domain songs. “Open” goes through scanning and reading; “Play view” lets you hear the chords and tab in time.",
  scanTitle: "Turn handwritten tab into data",
  scanLead:
    "Pick a scanned PDF or photos of a score: the page's orientation and tilt are fixed, and systems and measures are found on this device. For photos the white paper is cut out and the perspective and uneven lighting are corrected first. Then Claude reads the chords and the structure (repeats and signs), and you can tap a measure to check and correct it.",
  pickSource: "Pick a PDF or photos",
  pickFiles: "Choose PDF or photos",
  takePhoto: "Take a photo",
  pickHint:
    "One photo is one page. Put the paper on something darker, such as a desk, and fit the whole sheet in. If no file picker opens, open this link in Safari or Chrome (the Claude app may not allow picking files). On a computer you can also drag PDFs or photos onto this page.",
  samplesRow: "Samples (scan-like PDFs made from public-domain songs)",
  photosTaken: "Photos taken",
  trayTitle: "Photos taken (one per page)",
  trayHint: "Put them in page order. Analysing cuts out the white paper and corrects it.",
  analyse: "Analyse",
  nextPage: "Take the next page",
  addPhotos: "Add photos",
  cancel: "Cancel",
  scoreDetail: "Score details",
  backToScores: "← Scores",
  legend: "Legend",
  legendSystem: "System (staff + tab)",
  legendMeasure: "Measure (numbered through)",
  result: "Result",
  toAttention: "Next to check",
  draftNote: "Opened your earlier work (kept in this device's library).",
  discardDraft: "Discard the draft and start over",
  aiTitle: "Read with Claude (chords, structure, tab)",
  aiNote:
    "Sends the image of each system (corrected, for photos) to your Claude (your claude.ai account; in the Android app, your own API key) to read (tens of seconds per page). The PDF or photos themselves are not sent.",
  read: "Read",
  readTab: "Read the tab (rhythm, frets)",
  stop: "Stop",
  aiTabNote:
    "Once the chords and structure are read, the tab numbers and rhythm can be read too. Beat totals and fret spans are checked and odd measures marked to check.",
  readingNotes: "Notes from reading",
  checksHint:
    "Checks repeats against endings, D.S./Coda targets, sections, each measure's beat total and whether it can be fretted. Tap one to open its measure.",
  save: "Save gts.json",
  copyJson: "Copy JSON",
  openPlayView: "Open in the play view",
  openSavedGts: "Open a saved gts.json",
  showJson: "Show the content (gts JSON)",
  pages: "Pages",
  apiKeyTitle: "Claude API key",
  apiKeyHint: "Change your own API key used for reading, or remove it from this device.",
  apiKeyOpen: "Change or remove the API key",
  libraryTitle: "This device's library",
  libraryHint:
    "The PDFs and photos you open and the work on them are kept only in this device's browser (nothing goes to a server). Opening one again re-analyses the kept files so you can carry on. Clearing the browser's data removes them, so also save gts.json when a score is done.",
  moveSummary: "Move to another device (export, import)",
  moveHint:
    "Exports the whole library into one file to import on the new device. The work (small data) is written first and the PDFs and photos last, so the work moves even if the file is cut short or partly damaged.",
  withFiles: " Include PDFs and photos",
  export: "Export",
  import: "Import",
  importLabel: "Import an exported library",
  playGtsTitle: "Open a gts.json in the play view",
  playGtsHint: "A gts.json saved on another device opens in the play view on its own, without the PDF or photos.",
  pickGts: "Choose gts.json",
  footer:
    "GuitarMR · the layout (where the measures are) is found on the device; structure and chords are read by Claude. Reading the tab numbers and lyrics is still to come. The files you open and your work stay only in this device's browser.",
  screens: "Screens",
  scan: "Scan",
  editMeasure: "Edit measure",
  close: "Close",
  measureImage: "Image of this measure (neighbours faded)",
  chordsField: "Chords",
  chordsHint: "Separated by spaces. Add @ for the beat position: <code>C G/B@2.5</code>",
  tabField: "Tab (rhythm, frets)",
  tabHint:
    'One note at a time as length:content, separated by spaces. Length 4 = quarter, 8 = eighth (. dotted, t triplet); content string-fret (+ together, x mute), r rest, / strum. Then !d down, !u up. Example: <code>8:6-0+4-2!d 8:r 4:/ 8t:1-0 8t:1-2h 8t:1-3</code> <span id="f-tab-total"></span>',
  sectionField: "Section starting at this measure",
  sectionPlaceholder: "A, Chorus… (empty if none)",
  barsAndSigns: "Bar lines and signs",
  repeatStart: " Repeat start ‖:",
  barEnd: "Closing bar line",
  barNormal: "Normal",
  barDouble: "Double bar ‖",
  barFinal: "Final bar",
  barRepeatEnd: "Repeat end :‖",
  repeatTimes: "Times played (repeat end)",
  volta: "Ending",
  voltaPlaceholder: "1 or 1,2",
  simile: "Measure repeat",
  simileNone: "None",
  simileOne: "1 measure %",
  simileTwo: "2 measures",
  signs: "Signs",
  segno: " Segno 𝄋",
  coda: " Coda 𝄌",
  previous: "← Prev",
  reviewedNext: "Mark checked and next",
  next: "Next →",
  playView: "Play view",
  closePlayView: "Close the play view",
  play: "Play",
  slower: "Slower",
  tempo: "Tempo (BPM)",
  faster: "Faster",
  beatsPerBar: "Beats counted (per measure)",
  beat: "Beat",
  click: "Click",
  chordSound: "Chords",
  tabSound: "Tab",
  explain: "Explain",
  smaller: "Smaller text",
  larger: "Larger text",
  progressionNotes: "About the chord progression",
  arrangePanel: "Arrange: notes to play",
  closeExplanation: "Close the explanation",
};

/** A chord progression's name and what it does, by its id in @guitarmr/gts. */
interface Described {
  name: string;
  description: string;
  /** The English name guitarists use, shown next to a Japanese name. */
  alias?: string;
}

const JA = {
  locale: "ja-JP",
  // Measure states
  statuses: { unread: "未読", auto: "AI", attention: "要確認", reviewed: "確認済み" },
  // Score screen
  pages: (n: number) => `${n} ページ`,
  measures: (n: number) => `${n} 小節`,
  layers: (list: string) => `レイヤー: ${list}`,
  read: "読み取る",
  readMore: (unread: number) => `続きを読む（未読 ${unread} 小節）`,
  readTab: "TAB（リズム・フレット）を読む",
  readTabMore: (left: number) => `TAB の続きを読む（${left} 小節）`,
  saveAs: (name: string) => `${name} を保存`,
  checksTitle: (n: number) => `チェックで見つかったこと（${n} 件）`,
  noSystemsPhoto: "段が見つからないためスキップしました（TAB譜の6本線が写っているか、ぶれていないか確かめてください）",
  noSystemsPage: "段が見つからないためスキップしました（歌詞だけのページなど）",
  paper: "用紙",
  paperFound: "切り出して補正",
  paperMissing: "見つからず全体を補正",
  orientation: "向き",
  upright: "そのまま",
  rotated: (deg: number) => `${deg}° 回転`,
  skew: "傾き",
  systems: "段",
  analysis: "解析",
  seconds: (s: string) => `${s} 秒`,
  rereadPage: "このページを読み直す",
  rereadWarning: "このページの修正は上書きされます",
  pageImage: (page: number) => `p${page} の譜面`,
  photoWithPaper: "元の写真と切り出した用紙の範囲",
  photoWithoutPaper: "元の写真（用紙が見つからなかったので全体を使いました）",
  originalPhoto: "元の写真",
  loading: (name: string) => `${name} を読み込み中…`,
  analysingPhoto: (name: string, n: number, total: number) => `${name}: ${n} / ${total} 枚目の写真を補正・解析中…`,
  analysingPage: (name: string, n: number, total: number) => `${name}: ${n} / ${total} ページ目を解析中…`,
  cannotProcess: (name: string, error: string) => `${name} を処理できませんでした（${error}）。`,
  noSystemsInPhotos: (name: string) =>
    `${name}: どの写真にも段（TAB譜の6本線）が見つかりませんでした。紙全体が入るように、明るい場所で撮り直してください。`,
  noSystemsInPages: (name: string) => `${name}: どのページにも段（TAB譜の6本線）が見つかりませんでした。`,
  cannotKeep: "この画面では端末に保存できません。作業が終わったら gts.json を保存してください。",
  elapsed: (s: number) => `${s} 秒`,
  readErrors: {
    cancelled: "止めました。「続きを読む」で未読のページから再開できます。",
    rate_limited: "Claude の利用上限に達しました。時間をおいて「続きを読む」を押してください。",
    not_granted: "Claude の利用が許可されませんでした。",
    upstream_error: "Claude に接続できませんでした。少し待ってからもう一度押してください。",
    invalid_api_key: "Claude API キーが使えませんでした。もう一度押すとキーを入れ直せます。",
  } as Record<string, string>,
  cannotReadHere: (code: string) => `この画面では AI で読み取れません（${code}）。`,
  readDoneAttention: (n: number) => `読み終わりました。要確認の ${n} 小節から見直してください（枠をタップすると直せます）。`,
  readDone: "読み終わりました。枠をタップすると内容を確認・修正できます。",
  saveCancelled: "保存をキャンセルしました。",
  cannotSave: "この画面では保存できません。",
  saved: "保存しました。PDFと同じ場所に置くと Quest のアプリが読み込めます。",
  useCopy: (note: string) => `${note}「JSONをコピー」を使ってください。`,
  copied: "JSONをコピーしました。",
  copyFailed: "コピーできなかったので全体を選択しました。共有メニューからコピーしてください。",
  notGts: "gts ではありません",
  gtsOfOther: (name: string) => `${name} は、いま開いている PDF の gts ではありません（PDF の内容が違います）。`,
  opened: (name: string) => `${name} を開きました。`,
  cannotOpen: (name: string, error: string) => `${name} を開けませんでした（${error}）。`,
  cannotPlay: (name: string, error: string) => `${name} を演奏ビューで開けませんでした（${error}）。`,
  files: (n: number) => `${n} 個のファイル`,
  cannotReadFile: (name: string, error: string) => `${name} を読めませんでした（${error}）。端末にダウンロードしてから選んでください。`,
  skippedSome: (names: string) => `${names} は PDF でも写真でもないので外しました。`,
  skippedAll: (names: string) => `${names} はPDFでも写真でもないようです。スキャンしたPDFか、楽譜の写真を選んでください。`,
  listSeparator: "、",
  joinSentences: (parts: string[]) => parts.join(""),
  // Score list
  noFiles: "ファイルなし（同じ PDF・写真を開くと戻ります）",
  photos: (n: number) => `写真 ${n} 枚`,
  reviewedOf: (reviewed: number, total: number) => `確認済み ${reviewed} / ${total} 小節`,
  attentionCount: (n: number) => `要確認 ${n}`,
  open: "開く",
  playView: "演奏ビュー",
  remove: "削除",
  confirmRemove: (name: string) => `${name} と作業内容をこの端末から削除しますか？（保存した gts.json は消えません）`,
  removeLabel: (name: string) => `${name} を端末から削除`,
  storageUsed: (mb: string) => `この端末で使っている容量: ${mb} MB`,
  sampleTag: "サンプル",
  // Moving devices
  exporting: "書き出しています…",
  exported: (n: number) => `${n} 曲を書き出しました。新しい端末でこのページを開き「取り込む」で選んでください。`,
  cannotExport: (error: string) => `書き出せませんでした（${error}）。`,
  importing: (name: string) => `${name} を取り込んでいます…`,
  imported: (n: number) => `${n} 曲を取り込みました。`,
  importedWithoutFiles: (names: string) =>
    `${names} は PDF・写真が壊れていたか途中で切れていたので、作業内容だけ取り込みました（同じ PDF・写真を開くと戻ります）。`,
  importTruncated: "ファイルの最後が欠けていましたが、取り込める分はすべて取り込みました。",
  importFull: (n: number) => `${n} 曲は端末の容量が足りず保存できませんでした。`,
  cannotImport: (name: string, error: string) => `${name} を取り込めませんでした（${error}）。`,
  importErrors: {
    "not-export": "ライブラリの書き出しファイルではありません",
    "newer-version": "新しい版のアプリで書き出されたファイルです",
  },
  filesMissing: "この楽譜のファイルが端末に残っていません。",
  notInLibrary: "この楽譜はこの端末のライブラリにありません。",
  // Reading with Claude
  readingPage: (page: number, n: number, total: number, tab: boolean) =>
    `p${page}${tab ? " の TAB" : ""} を読んでいます（${n} / ${total} ページ）…`,
  pageUnreadable: (page: number, code: string) =>
    `p${page}: ${code === "invalid_json" ? "答えを読み取れませんでした" : "このページは読めませんでした"}（${code}）`,
  // Photo tray
  analysePhotos: (n: number) => `この ${n} 枚で解析する`,
  movePhotoEarlier: (page: number) => `p${page} を前へ`,
  removePhoto: (page: number) => `p${page} を外す`,
  // Measure editor
  memo: (comment: string) => `メモ: ${comment}`,
  simileMeasure: "繰り返し記号の小節（前の小節と同じ）",
  noTab: "TAB に何も書かれていない",
  notRead: "まだ読んでいません",
  beatTotal: (total: string, perBar: number) => `合計 ${total} / ${perBar} 拍`,
  badChords: (tokens: string[], perBar: number) =>
    `${tokens.map((t) => `「${t}」`).join("")}をコードとして読めません（拍は 1〜${perBar}）。直してください。`,
  badTab: (problems: string[]) => `${problems.join("。")}。直してください。`,
  // Play view
  pause: "一時停止",
  play: "再生",
  pass: (n: number) => `${n}回目`,
  measureLabel: (n: number) => `${n}小節目`,
  measureShort: (n: number) => `${n}小節`,
  // Explanation
  /** "a（b）": a note in parentheses after a text. */
  aside: (text: string, note: string) => `${text}（${note}）`,
  minorKey: "マイナー",
  majorKey: "メジャー",
  scaleIntro: "・スケール ",
  otherScales: "ほかに合うスケール:",
  fromScore: "楽譜の表記",
  fromChords: "コードから推定",
  degreesNote: (source: string) => `度数はキー（${source}）の主音を Ⅰ として表示。`,
  soundingKey: (capo: number, key: string) => `カポ${capo}で実音は ${key}。`,
  tapHint: "括弧の進行名やスケール名をタップすると解説が出ます。",
  noProgressions: "代表的なコード進行は見つかりませんでした。",
  fromMeasure: (n: number) => `${n}小節目から`,
  placesInSong: "この曲で弾く場所:",
  sameNotes: (names: string) => `同じ音の並び: ${names}`,
  fromMelody: "メロディ（TAB の単音）",
  fromChordTones: "コードの構成音",
  coverage: (source: string, percent: number) => `${source}で使われている音の ${percent}% がこのスケールの音`,
  outside: (notes: string) => `（外れる音: ${notes}）`,
  sentenceEnd: "。",
  onFretboard: (scale: string) => `${scale}の指板上の位置`,
  circleButton: "五度圏・コード",
  circleTitle: (key: string) => `${key}の五度圏`,
  circleLegend: "濃い色のマスがキー、薄い色のマスがダイアトニックコード。外側の ● がスケールの音（大きい ● は主音）。",
  usableNotes: (scale: string) => `使える音: ${scale}`,
  keyScaleNotes: (scale: string, notes: string) => `ダイアトニックコードはキーの音階（${scale}: ${notes}）で作るコード。`,
  diatonicHeading: "ダイアトニックコードと代理コード",
  inSong: "曲中",
  functions: { tonic: "T", subdominant: "SD", dominant: "D" } as Record<ChordFunction, string>,
  functionNames: { tonic: "トニック", subdominant: "サブドミナント", dominant: "ドミナント" } as Record<ChordFunction, string>,
  substituteKinds: {
    "same-function": "同じ機能",
    tritone: "裏コード",
    borrowed: "同主調から借用",
    "harmonic-minor": "和声的短音階",
  } as Record<SubstituteKind, string>,
  substituteNote:
    "T（トニック）は安定、SD（サブドミナント）は少し動き出す、D（ドミナント）は Ⅰ に戻りたくなる響き。→ の後ろが代わりに弾けるコード（代理コード）: 同じ機能のダイアトニックコード、Ⅴ7 の代わりに半音上から解決する裏コード、同主調から借りたサブドミナント（サブドミナントマイナーなど）。7th を省いた三和音（C、Dm…）でも同じ働き。",
  relatedKeys: (keys: string) => `近い調: ${keys}`,
  relatedNames: { dominant: "属調", subdominant: "下属調", relative: "平行調", parallel: "同主調" } as Record<keyof RelatedKeys, string>,
  arrangeButton: "アレンジ",
  arrangeOver: (chord: string) => `${chord}の上で弾ける音`,
  arrangeNoChord: "スケールの音",
  arrangeLegend: "塗りの数字がコードの音（安牌）、白抜きがスケールの音。丸で囲んだのが主音。数字はフレット（カポから）。",
  arrangeLegendScale: "白抜きがスケールの音。丸で囲んだのが主音。数字はフレット（カポから）。",
  progressions: {
    canon: { name: "カノン進行", description: "Ⅰ→Ⅴ→Ⅵm→Ⅲm（→Ⅳ→Ⅰ→Ⅳ→Ⅴ）。ベースが一段ずつ下りていく、パッヘルベルのカノン由来の定番進行。" },
    "royal-road": { name: "王道進行", description: "Ⅳ→Ⅴ→Ⅲm→Ⅵm。盛り上がった Ⅴ から Ⅰ に行かずに Ⅲm→Ⅵm へ、切なく着地する J-POP のサビの定番。" },
    komuro: { name: "小室進行", description: "Ⅵm→Ⅳ→Ⅴ→Ⅰ。マイナーで始まり明るい Ⅰ へ抜ける、疾走感のある進行。" },
    "two-five-one": {
      name: "ツーファイブワン",
      description: "Ⅱm→Ⅴ7→Ⅰ。Ⅱm で準備し、Ⅴ7 で緊張を作って Ⅰ に解決する、いちばん基本的な解決の形（マイナーでは Ⅱm7-5→Ⅴ7→Ⅰm）。",
    },
    cadence: { name: "カデンツ（Ⅳ→Ⅴ→Ⅰ）", description: "サブドミナント→ドミナント→トニック。曲やフレーズの終わりをはっきり締めくくる流れ。" },
    "dominant-motion": { name: "ドミナントモーション", description: "Ⅴ(7)→Ⅰ。不安定な Ⅴ が主和音の Ⅰ に落ち着く、終止感のもと。" },
    "secondary-dominant": {
      name: "セカンダリー・ドミナント",
      description: "Ⅰ 以外のコードへ向かう 7th コード。行き先を一時的に Ⅰ に見立て、その 5 度上の 7th で強く引き寄せる。",
    },
    "two-five": { name: "ツーファイブ", description: "Ⅱm→Ⅴ7。解決先を期待させる準備の動き。ここでは Ⅰ に行かずに次へ進む。" },
    plagal: { name: "Ⅳ→Ⅰ（アーメン終止）", description: "サブドミナントから直接トニックへ。ドミナントを通らない、柔らかい戻り方。" },
    sus4: { name: "sus4 の解決", description: "sus4 の 4 度の音が 3 度へ下りて解決する。宙に浮いた響きが落ち着く、小さな動き。" },
  } as Record<string, Described>,
  scales: {
    major: { name: "メジャースケール（長音階）", alias: "Major scale (Ionian)", description: "C から始めると C D E F G A B C。明るく安定した、西洋音楽のいちばん基本の音階。" },
    "natural-minor": { name: "ナチュラルマイナースケール（自然短音階）", alias: "Natural minor (Aeolian)", description: "A から始めると A B C D E F G A。暗く落ち着いた響きの、マイナーキーの基本の音階。" },
    "major-pentatonic": {
      name: "メジャーペンタトニック（ヨナ抜き長音階）",
      alias: "Major pentatonic",
      description: "長音階から 4 番目と 7 番目（C から始めると F と B）を抜いた 5 音。童謡や演歌、J-POP のメロディに多い、素朴で明るい響き。",
    },
    "minor-pentatonic": {
      name: "マイナーペンタトニック（民謡音階）",
      alias: "Minor pentatonic",
      description: "短音階から 2 番目と 6 番目を抜いた 5 音。ロックのギターソロの定番で、日本の民謡にも同じ並びが現れる。",
    },
    "yona-nuki-minor": { name: "ヨナ抜き短音階（平調子）", alias: "Hirajoshi scale", description: "短音階から 4 番目と 7 番目を抜いた 5 音。箏の平調子と同じ並びで、もの悲しい和の響き。" },
    "miyako-bushi": {
      name: "都節音階（陰音階）",
      alias: "In scale (Miyako-bushi)",
      description: "半音を 2 か所に含む 5 音。さくらさくらや江戸の俗謡に聞かれる、しっとりと陰りのある日本の音階。",
    },
    ryukyu: {
      name: "沖縄音階（琉球音階）",
      alias: "Ryukyu scale (Okinawan)",
      description: "C から始めると C E F G B。長音階から 2 番目と 6 番目（D と A）を抜いた 5 音で、沖縄民謡らしい南国の明るさが出る。",
    },
    ritsu: { name: "律音階", alias: "Ritsu scale", description: "雅楽や民謡に使われる 5 音。3 度の音がなく、長調とも短調ともつかない、おおらかな響き。" },
    blues: { name: "ブルーノートスケール", alias: "Blues scale", description: "マイナーペンタトニックに ♭5 のブルーノートを加えた音階。ブルースやロックの泥くさい響き。" },
    "harmonic-minor": {
      name: "ハーモニックマイナースケール（和声短音階）",
      alias: "Harmonic minor",
      description: "自然短音階の 7 番目を半音上げ、Ⅴ7 から Ⅰm へ強く解決できるようにした音階。♭6 と 7 の間の広い音程が異国風。",
    },
    "melodic-minor": {
      name: "メロディックマイナースケール（旋律短音階）",
      alias: "Melodic minor",
      description: "自然短音階の 6 番目と 7 番目を半音上げ、上りのメロディを滑らかにした音階。ジャズでもよく使う。",
    },
    dorian: { name: "ドリアンスケール", alias: "Dorian", description: "自然短音階の 6 番目を半音上げた教会旋法。マイナーなのに暗くなりすぎない、ファンクやジャズで好まれる響き。" },
    mixolydian: { name: "ミクソリディアンスケール", alias: "Mixolydian", description: "長音階の 7 番目を半音下げた教会旋法。ロックやブルースの、ゆるくて明るい響き。" },
    lydian: { name: "リディアンスケール", alias: "Lydian", description: "長音階の 4 番目を半音上げた教会旋法。浮遊感のある、映画音楽のような明るさ。" },
    phrygian: { name: "フリジアンスケール", alias: "Phrygian", description: "自然短音階の 2 番目を半音下げた教会旋法。フラメンコのような、スペイン風の緊張感。" },
  } as Record<string, Described>,
};

export type Messages = typeof JA;

const EN: Messages = {
  locale: "en-US",
  statuses: { unread: "Unread", auto: "AI", attention: "Check", reviewed: "Checked" },
  pages: (n) => `${n} ${n === 1 ? "page" : "pages"}`,
  measures: (n) => `${n} ${n === 1 ? "measure" : "measures"}`,
  layers: (list) => `Layers: ${list}`,
  read: "Read",
  readMore: (unread) => `Read on (${unread} unread)`,
  readTab: "Read the tab (rhythm, frets)",
  readTabMore: (left) => `Read the rest of the tab (${left} measures)`,
  saveAs: (name) => `Save ${name}`,
  checksTitle: (n) => `Found by the checks (${n})`,
  noSystemsPhoto: "Skipped: no systems found (check that the six tab lines are in the photo and not blurred)",
  noSystemsPage: "Skipped: no systems found (a lyrics-only page, for example)",
  paper: "Paper",
  paperFound: "cut out and corrected",
  paperMissing: "not found, whole photo corrected",
  orientation: "Orientation",
  upright: "upright",
  rotated: (deg) => `rotated ${deg}°`,
  skew: "Tilt",
  systems: "Systems",
  analysis: "Analysis",
  seconds: (s) => `${s} s`,
  rereadPage: "Read this page again",
  rereadWarning: "Corrections on this page are overwritten",
  pageImage: (page) => `Score page ${page}`,
  photoWithPaper: "The original photo and the paper cut out of it",
  photoWithoutPaper: "The original photo (no paper found, so all of it was used)",
  originalPhoto: "Original photo",
  loading: (name) => `Loading ${name}…`,
  analysingPhoto: (name, n, total) => `${name}: correcting and analysing photo ${n} of ${total}…`,
  analysingPage: (name, n, total) => `${name}: analysing page ${n} of ${total}…`,
  cannotProcess: (name, error) => `Could not process ${name} (${error}).`,
  noSystemsInPhotos: (name) =>
    `${name}: no systems (six tab lines) found in any photo. Take them again in good light with the whole sheet in view.`,
  noSystemsInPages: (name) => `${name}: no systems (six tab lines) found on any page.`,
  cannotKeep: "This screen cannot keep scores on the device. Save gts.json when you are done.",
  elapsed: (s) => `${s} s`,
  readErrors: {
    cancelled: "Stopped. “Read on” resumes from the unread pages.",
    rate_limited: "Claude's usage limit was reached. Wait a while, then press “Read on”.",
    not_granted: "Using Claude was not allowed.",
    upstream_error: "Could not reach Claude. Wait a moment and press again.",
    invalid_api_key: "The Claude API key did not work. Press again to enter the key again.",
  },
  cannotReadHere: (code) => `This screen cannot read with AI (${code}).`,
  readDoneAttention: (n) => `Done reading. Start checking from the ${n} measures marked to check (tap a frame to correct it).`,
  readDone: "Done reading. Tap a frame to check or correct it.",
  saveCancelled: "Saving was cancelled.",
  cannotSave: "This screen cannot save.",
  saved: "Saved. Put it next to the PDF and the Quest app can load it.",
  useCopy: (note) => `${note} Use “Copy JSON”.`,
  copied: "Copied the JSON.",
  copyFailed: "Could not copy, so all of it is selected. Copy it from the share menu.",
  notGts: "not a gts file",
  gtsOfOther: (name) => `${name} is not the gts of the PDF open now (the PDF differs).`,
  opened: (name) => `Opened ${name}.`,
  cannotOpen: (name, error) => `Could not open ${name} (${error}).`,
  cannotPlay: (name, error) => `Could not open ${name} in the play view (${error}).`,
  files: (n) => `${n} files`,
  cannotReadFile: (name, error) => `Could not read ${name} (${error}). Download it to the device first, then pick it.`,
  skippedSome: (names) => `Left out ${names}: neither PDF nor photo.`,
  skippedAll: (names) => `${names} do not look like PDFs or photos. Pick a scanned PDF or photos of a score.`,
  listSeparator: ", ",
  joinSentences: (parts) => parts.join(" "),
  noFiles: "No files (open the same PDF or photos to bring them back)",
  photos: (n) => `${n} ${n === 1 ? "photo" : "photos"}`,
  reviewedOf: (reviewed, total) => `${reviewed} / ${total} measures checked`,
  attentionCount: (n) => `${n} to check`,
  open: "Open",
  playView: "Play view",
  remove: "Delete",
  confirmRemove: (name) => `Delete ${name} and its work from this device? (Saved gts.json files stay.)`,
  removeLabel: (name) => `Delete ${name} from the device`,
  storageUsed: (mb) => `Space used on this device: ${mb} MB`,
  sampleTag: "Sample",
  exporting: "Exporting…",
  exported: (n) => `Exported ${n} ${n === 1 ? "score" : "scores"}. Open this page on the new device and pick the file with “Import”.`,
  cannotExport: (error) => `Could not export (${error}).`,
  importing: (name) => `Importing ${name}…`,
  imported: (n) => `Imported ${n} ${n === 1 ? "score" : "scores"}.`,
  importedWithoutFiles: (names) =>
    `The PDFs or photos of ${names} were damaged or cut short, so only the work was imported (open the same PDF or photos to bring them back).`,
  importTruncated: "The end of the file was missing; everything that could be imported was.",
  importFull: (n) => `${n} ${n === 1 ? "score" : "scores"} could not be saved: the device is out of space.`,
  cannotImport: (name, error) => `Could not import ${name} (${error}).`,
  importErrors: {
    "not-export": "not a library export file",
    "newer-version": "exported by a newer version of the app",
  },
  filesMissing: "This score's files are no longer on the device.",
  notInLibrary: "This score is not in this device's library.",
  readingPage: (page, n, total, tab) => `Reading ${tab ? "the tab of " : ""}p${page} (page ${n} of ${total})…`,
  pageUnreadable: (page, code) =>
    `p${page}: ${code === "invalid_json" ? "could not make out the answer" : "this page could not be read"} (${code})`,
  analysePhotos: (n) => `Analyse these ${n} ${n === 1 ? "photo" : "photos"}`,
  movePhotoEarlier: (page) => `Move p${page} earlier`,
  removePhoto: (page) => `Remove p${page}`,
  memo: (comment) => `Note: ${comment}`,
  simileMeasure: "Measure-repeat measure (same as the one before)",
  noTab: "Nothing written in the tab",
  notRead: "Not read yet",
  beatTotal: (total, perBar) => `Total ${total} / ${perBar} beats`,
  badChords: (tokens, perBar) =>
    `Cannot read ${tokens.map((t) => `“${t}”`).join(" ")} as chords (beats 1 to ${perBar}). Please correct them.`,
  badTab: (problems) => `${problems.join(". ")}. Please correct it.`,
  pause: "Pause",
  play: "Play",
  pass: (n) => `${n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`} time`,
  measureLabel: (n) => `Measure ${n}`,
  measureShort: (n) => `m.${n}`,
  aside: (text, note) => `${text} (${note})`,
  minorKey: "minor",
  majorKey: "major",
  scaleIntro: " · Scale ",
  otherScales: "Also fits:",
  fromScore: "as written on the score",
  fromChords: "estimated from the chords",
  degreesNote: (source) => `Degrees count from the key's tonic as Ⅰ (key ${source}).`,
  soundingKey: (capo, key) => ` With capo ${capo} it sounds in ${key}.`,
  tapHint: " Tap a bracketed progression or a scale name for an explanation.",
  noProgressions: " No typical progressions were found.",
  fromMeasure: (n) => `from measure ${n}`,
  placesInSong: "Where it is played:",
  sameNotes: (names) => `Same notes as: ${names}`,
  fromMelody: "the melody (single notes of the tab)",
  fromChordTones: "the chord tones",
  coverage: (source, percent) => `${percent}% of the notes in ${source} are in this scale`,
  outside: (notes) => ` (outside: ${notes})`,
  sentenceEnd: ".",
  onFretboard: (scale) => `${scale} on the fretboard`,
  circleButton: "Circle of fifths",
  circleTitle: (key) => `${key} on the circle of fifths`,
  circleLegend: "The dark cell is the key, the light cells its diatonic chords. Dots outside mark the scale's notes (the big dot is the tonic).",
  usableNotes: (scale) => `Notes to use: ${scale}`,
  keyScaleNotes: (scale, notes) => `The diatonic chords are made of the key's scale (${scale}: ${notes}).`,
  diatonicHeading: "Diatonic chords and substitutes",
  inSong: "in song",
  functions: { tonic: "T", subdominant: "SD", dominant: "D" },
  functionNames: { tonic: "tonic", subdominant: "subdominant", dominant: "dominant" },
  substituteKinds: {
    "same-function": "same function",
    tritone: "tritone sub",
    borrowed: "borrowed",
    "harmonic-minor": "harmonic minor",
  },
  substituteNote:
    "T (tonic) is at rest, SD (subdominant) starts to move, D (dominant) wants to go home to Ⅰ. After → are chords that can stand in (substitutes): diatonic chords of the same function, the tritone substitute that resolves from a half step above instead of Ⅴ7, and subdominants borrowed from the parallel key (such as the subdominant minor). Triads without the 7th (C, Dm, ...) work the same way.",
  relatedKeys: (keys) => `Close keys: ${keys}`,
  relatedNames: { dominant: "dominant", subdominant: "subdominant", relative: "relative", parallel: "parallel" },
  arrangeButton: "Arrange",
  arrangeOver: (chord) => `Notes to play over ${chord}`,
  arrangeNoChord: "Notes of the scale",
  arrangeLegend: "Filled numbers are the chord's notes (the safe bet), outlined ones the rest of the scale; the ringed one is the tonic. Numbers are frets (from the capo).",
  arrangeLegendScale: "Outlined numbers are the scale's notes; the ringed one is the tonic. Numbers are frets (from the capo).",
  progressions: {
    canon: { name: "Canon progression", description: "Ⅰ→Ⅴ→Ⅵm→Ⅲm (→Ⅳ→Ⅰ→Ⅳ→Ⅴ). The bass steps down one degree at a time; the classic from Pachelbel's Canon." },
    "royal-road": {
      name: "Royal road progression",
      description: "Ⅳ→Ⅴ→Ⅲm→Ⅵm. The Ⅴ builds up but lands on Ⅲm→Ⅵm instead of Ⅰ, bittersweet; a J-pop chorus staple.",
    },
    komuro: { name: "Komuro progression", description: "Ⅵm→Ⅳ→Ⅴ→Ⅰ. Starts in minor and breaks out into a bright Ⅰ, with a driving feel." },
    "two-five-one": {
      name: "Two-five-one",
      description: "Ⅱm→Ⅴ7→Ⅰ. Ⅱm prepares, Ⅴ7 builds tension, Ⅰ resolves it: the most basic resolution (in minor, Ⅱm7-5→Ⅴ7→Ⅰm).",
    },
    cadence: { name: "Cadence (Ⅳ→Ⅴ→Ⅰ)", description: "Subdominant → dominant → tonic. Clearly closes a song or a phrase." },
    "dominant-motion": { name: "Dominant motion", description: "Ⅴ(7)→Ⅰ. The unstable Ⅴ settles on the tonic Ⅰ: where the sense of ending comes from." },
    "secondary-dominant": {
      name: "Secondary dominant",
      description: "A 7th chord leading to a chord other than Ⅰ. It treats its target as a momentary Ⅰ and pulls to it from a fifth above.",
    },
    "two-five": { name: "Two-five", description: "Ⅱm→Ⅴ7. A preparing move that makes you expect a resolution; here it moves on without reaching Ⅰ." },
    plagal: { name: "Ⅳ→Ⅰ (plagal, “Amen” cadence)", description: "Straight from the subdominant to the tonic, skipping the dominant: a soft return." },
    sus4: { name: "sus4 resolution", description: "The suspended 4th falls to the 3rd. A small move from a floating sound to a settled one." },
  },
  scales: {
    major: { name: "major scale", description: "From C: C D E F G A B C. Bright and stable: the most basic scale of Western music." },
    "natural-minor": { name: "natural minor scale", description: "From A: A B C D E F G A. Dark and calm: the basic scale of a minor key." },
    "major-pentatonic": {
      name: "major pentatonic (yonanuki major)",
      description: "The major scale without its 4th and 7th: five notes. Simple and bright; common in children's songs, enka and J-pop melodies.",
    },
    "minor-pentatonic": {
      name: "minor pentatonic (min'yō scale)",
      description: "The minor scale without its 2nd and 6th: five notes. The rock guitar solo standard; Japanese folk songs use the same notes.",
    },
    "yona-nuki-minor": {
      name: "Hirajoshi scale (yonanuki minor)",
      description: "The minor scale without its 4th and 7th: five notes, the same as the koto's hirajōshi tuning. A wistful Japanese sound.",
    },
    "miyako-bushi": {
      name: "miyako-bushi scale (in scale)",
      description: "Five notes with two semitones. The quiet, shadowed Japanese scale of Sakura Sakura and Edo-period songs.",
    },
    ryukyu: {
      name: "Okinawan scale (Ryūkyū scale)",
      description: "From C: C E F G B, the major scale without its 2nd and 6th. Gives Okinawan folk songs their southern brightness.",
    },
    ritsu: { name: "ritsu scale", description: "Five notes of gagaku and folk songs. With no 3rd it is neither major nor minor: an open, easy sound." },
    blues: { name: "blues scale", description: "The minor pentatonic plus the ♭5 blue note. The gritty sound of blues and rock." },
    "harmonic-minor": {
      name: "harmonic minor scale",
      description: "The natural minor with a raised 7th, so Ⅴ7 resolves strongly to Ⅰm. The wide step between ♭6 and 7 sounds exotic.",
    },
    "melodic-minor": {
      name: "melodic minor scale",
      description: "The natural minor with raised 6th and 7th, smoothing rising melodies. Much used in jazz.",
    },
    dorian: { name: "Dorian mode", description: "The natural minor with a raised 6th. Minor but not too dark; loved in funk and jazz." },
    mixolydian: { name: "Mixolydian mode", description: "The major scale with a lowered 7th. The relaxed brightness of rock and blues." },
    lydian: { name: "Lydian mode", description: "The major scale with a raised 4th. A floating, film-score brightness." },
    phrygian: { name: "Phrygian mode", description: "The natural minor with a lowered 2nd. A Spanish, flamenco-like tension." },
  },
};

export const MESSAGES: Record<Lang, Messages> = { ja: JA, en: EN };
