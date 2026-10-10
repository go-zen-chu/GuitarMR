/**
 * The play view: the song's measures in play order (repeats and jumps
 * expanded), each showing its chords at their beats, the lyrics of the
 * current verse and chord diagrams when the gts file has them. Playing
 * follows the tempo: the current measure is highlighted, its beat marks
 * (4, 8 or 16 per 4/4 measure, from the song's feel) fill in, and the
 * view scrolls so the current line stays near the top, on any screen size.
 */

import {
  type GtsDocument,
  type PlayStep,
  type SoundingChords,
  lyricsFor,
  playOrder,
  soundingChords,
} from "@guitarmr/gts";

const SVG = "http://www.w3.org/2000/svg";
const ZOOM_KEY = "guitarmr.player.zoom";
const CLICK_KEY = "guitarmr.player.click";

/** "F#m7-5" → "F♯m7-5", "Bb" → "B♭" (display only). */
export function prettyChord(symbol: string): string {
  return symbol.replace(/^([A-G])#/, "$1♯").replace(/^([A-G])b/, "$1♭").replace(/\/([A-G])#/, "/$1♯").replace(/\/([A-G])b/, "/$1♭");
}

/** A small chord diagram: strings 6 (left) to 1, frets from the lowest used. */
function diagram(frets: (number | null)[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 60 70");
  svg.setAttribute("class", "diagram");
  const played = frets.filter((f): f is number => typeof f === "number" && f > 0);
  const base = played.length && Math.max(...played) > 4 ? Math.min(...played) : 1;
  const x = (s: number) => 8 + (5 - s) * 9; // s: 0 = string 1 (high)
  const add = (name: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  for (let s = 0; s < 6; s++) add("line", { x1: x(s), y1: 14, x2: x(s), y2: 66, class: "dg-line" });
  for (let f = 0; f <= 4; f++) add("line", { x1: 8, y1: 14 + f * 13, x2: 53, y2: 14 + f * 13, class: f === 0 && base === 1 ? "dg-nut" : "dg-line" });
  if (base > 1) add("text", { x: 56, y: 24, class: "dg-text" }, String(base));
  frets.forEach((f, s) => {
    if (f === null || f === -1) add("text", { x: x(s), y: 10, class: "dg-text", "text-anchor": "middle" }, "×");
    else if (f === 0) add("circle", { cx: x(s), cy: 7, r: 3, class: "dg-open" });
    else add("circle", { cx: x(s), cy: 14 + (f - base + 0.5) * 13, r: 4, class: "dg-dot" });
  });
  return svg;
}

export function createPlayer() {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const el = {
    root: $<HTMLElement>("player"),
    title: $<HTMLElement>("player-title"),
    meta: $<HTMLElement>("player-meta"),
    bars: $<HTMLElement>("player-bars"),
    play: $<HTMLButtonElement>("player-play"),
    bpm: $<HTMLInputElement>("player-bpm"),
    slower: $<HTMLButtonElement>("player-slower"),
    faster: $<HTMLButtonElement>("player-faster"),
    click: $<HTMLInputElement>("player-click"),
    smaller: $<HTMLButtonElement>("player-smaller"),
    larger: $<HTMLButtonElement>("player-larger"),
    count: $<HTMLElement>("player-count"),
    close: $<HTMLButtonElement>("player-close"),
    feel: $<HTMLElement>("player-feel"),
  };

  let doc: GtsDocument | null = null;
  /** Beat marks per 4/4 measure: 4 (quarters), 8 (eighths) or 16 (sixteenths). */
  let feel: 4 | 8 | 16 = 4;
  let currentSlot = -1;
  let steps: PlayStep[] = [];
  let cells: HTMLElement[] = [];
  let totalBeats = 0;
  // Timing: position in beats = anchorBeat + (clock() - anchorTime) * bpm / 60.
  let playing = false;
  let anchorBeat = 0;
  let anchorTime = 0;
  let current = -1;
  let rowTop = -1;
  let frame = 0;
  let audio: AudioContext | null = null;
  let nextClick = 0;
  let wakeLock: { release(): Promise<void> } | null = null;

  const store = {
    get: (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        // per-viewer convenience only
      }
    },
  };
  let zoom = Number(store.get(ZOOM_KEY)) || 1;
  el.click.checked = store.get(CLICK_KEY) === "1";
  const applyZoom = () => el.root.style.setProperty("--zoom", String(zoom));
  applyZoom();

  const bpm = () => Math.min(Math.max(Number(el.bpm.value) || 80, 30), 300);
  const clock = () => (audio ? audio.currentTime : performance.now() / 1000);
  const position = () => (playing ? anchorBeat + ((clock() - anchorTime) * bpm()) / 60 : anchorBeat);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function build() {
    if (!doc) return;
    steps = playOrder(doc);
    const sounding: SoundingChords[] = soundingChords(steps);
    totalBeats = steps.length ? steps[steps.length - 1]!.start + steps[steps.length - 1]!.beats : 0;
    const shapes = doc.chordShapes ?? {};
    const hasLyrics = steps.some((s) => s.measure.lyrics?.length);
    el.title.textContent = doc.meta.title;
    const facts = [
      doc.meta.key ? `Key ${prettyChord(doc.meta.key)}` : "",
      doc.meta.capo ? `Capo ${doc.meta.capo}` : "",
      doc.meta.timeSignature ?? "",
      `${steps.length} 小節`,
    ].filter(Boolean);
    el.meta.textContent = facts.join(" · ");
    cells = steps.map((step, k) => {
      const m = step.measure;
      const cell = document.createElement("div");
      cell.className = "bar";
      cell.dataset.k = String(k);
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      if (step.section) cell.classList.add("starts-section");
      if (m.barStart === "repeat-start") cell.classList.add("repeat-start");
      if (m.barEnd === "repeat-end") cell.classList.add("repeat-end");
      if (m.barEnd === "double" || m.barEnd === "final") cell.classList.add(m.barEnd);
      const head = document.createElement("div");
      head.className = "bar-head";
      const marks: string[] = [];
      if (step.section) marks.push(`[${step.section}]`);
      if (m.volta) marks.push(`${m.volta.join(",")}.`);
      if (m.navigation?.includes("segno")) marks.push("𝄋");
      if (m.navigation?.includes("coda")) marks.push("𝄌");
      if (m.navigation?.includes("to-coda")) marks.push("To 𝄌");
      if (m.navigation?.some((n) => n.startsWith("ds"))) marks.push("D.S.");
      if (m.navigation?.some((n) => n.startsWith("dc"))) marks.push("D.C.");
      if (m.navigation?.includes("fine")) marks.push("Fine");
      if (m.simile) marks.push("%");
      for (const text of marks) {
        const span = document.createElement("span");
        span.className = text.startsWith("[") ? "mark section" : "mark";
        span.textContent = text;
        head.append(span);
      }
      if (step.pass > 1) {
        const pass = document.createElement("span");
        pass.className = "mark pass";
        pass.textContent = `${step.pass}回目`;
        head.append(pass);
      }
      const lane = document.createElement("div");
      const { chords, carried } = sounding[k]!;
      lane.className = `chords${carried ? " carried" : ""}`;
      // Each chord takes room in proportion to how long it sounds, but never
      // less than its name: long names push the next one along instead of
      // overlapping it.
      const firstBeat = chords[0]?.beat ?? 1;
      if (firstBeat > 1) {
        const lead = document.createElement("span");
        lead.className = "lead";
        lead.style.flexGrow = String(firstBeat - 1);
        lane.append(lead);
      }
      chords.forEach((c, j) => {
        const chord = document.createElement("span");
        chord.className = "chord";
        const end = chords[j + 1]?.beat ?? step.beats + 1;
        chord.style.flexGrow = String(Math.max(end - (c.beat ?? 1), 0.25));
        chord.textContent = prettyChord(c.symbol);
        lane.append(chord);
      });
      cell.append(head, lane);
      // Lyrics get their line in every measure of a song that has lyrics, so
      // chords and lyrics sit at the same height across a row; diagrams,
      // which only some measures have, come last.
      const lyric = lyricsFor(step);
      if (hasLyrics) {
        const p = document.createElement("div");
        p.className = "lyric";
        p.textContent = lyric ?? "";
        cell.append(p);
      }
      cell.append(beatMarks(step.beats));
      const withShapes = chords.filter((c) => c.shape && shapes[c.shape]);
      if (withShapes.length && !carried) {
        const row = document.createElement("div");
        row.className = "diagrams";
        for (const c of withShapes) row.append(diagram(shapes[c.shape!]!.frets as (number | null)[]));
        cell.append(row);
      }
      cell.setAttribute("aria-label", `${k + 1}小節目 ${chords.map((c) => c.symbol).join(" ")} ${lyric ?? ""}`);
      return cell;
    });
    el.bars.replaceChildren(...cells);
    current = -1;
    rowTop = -1;
    fit();
  }

  /**
   * Shrink chord names (and lyrics) that do not fit their measure, in two
   * steps; every measure of a row takes the step its tightest measure
   * needs, so a row keeps one size and its baselines line up.
   */
  function fit() {
    const levels = (selector: string) =>
      [...el.bars.querySelectorAll<HTMLElement>(selector)].map((node) => {
        node.classList.remove("fit-1", "fit-2");
        let level = 0;
        for (const cls of ["fit-1", "fit-2"]) {
          if (node.scrollWidth <= node.clientWidth + 1) break;
          node.classList.remove("fit-1");
          node.classList.add(cls);
          level++;
        }
        node.classList.remove("fit-1", "fit-2");
        return { node, level, top: node.closest<HTMLElement>(".bar")!.offsetTop };
      });
    for (const selector of [".chords", ".lyric"]) {
      const items = levels(selector);
      const rowLevel = new Map<number, number>();
      for (const { level, top } of items) rowLevel.set(top, Math.max(rowLevel.get(top) ?? 0, level));
      for (const { node, top } of items) {
        const level = rowLevel.get(top)!;
        if (level) node.classList.add(`fit-${level}`);
      }
    }
  }


  /** One mark per counted note of the measure; marks on the beat are taller. */
  function beatMarks(beats: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `beats feel-${feel}`;
    row.setAttribute("aria-hidden", "true");
    const perBeat = feel / 4;
    for (let i = 0; i < beats * perBeat; i++) {
      const tick = document.createElement("span");
      tick.className = i % perBeat === 0 ? "tick on-beat" : "tick";
      row.append(tick);
    }
    return row;
  }

  function setFeel(next: 4 | 8 | 16) {
    feel = next;
    for (const b of el.feel.querySelectorAll<HTMLButtonElement>("button")) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.feel) === feel));
    }
    cells.forEach((cell, k) => cell.querySelector(".beats")?.replaceWith(beatMarks(steps[k]!.beats)));
    currentSlot = -1;
    if (current >= 0) markBeat(Math.max(position(), steps[current]!.start));
  }

  /** Fill the marks of the current measure up to the note being played. */
  function markBeat(beat: number) {
    const step = steps[current];
    if (!step) return;
    const ticks = cells[current]!.querySelectorAll<HTMLElement>(".tick");
    const slot = Math.min(Math.floor((beat - step.start) * (feel / 4)), ticks.length - 1);
    if (slot === currentSlot) return;
    currentSlot = slot;
    ticks.forEach((t, i) => {
      t.classList.toggle("done", i < slot);
      t.classList.toggle("now", i === slot);
    });
  }

  function stepAt(beat: number): number {
    let lo = 0;
    let hi = steps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (steps[mid]!.start <= beat) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function show(beat: number) {
    if (!steps.length) return;
    const k = stepAt(Math.max(beat, 0));
    if (k !== current) {
      cells[current]?.classList.remove("current");
      for (const t of cells[current]?.querySelectorAll(".tick") ?? []) t.classList.remove("done", "now");
      current = k;
      currentSlot = -1;
      const cell = cells[k]!;
      cell.classList.add("current");
      // Keep the current line about a quarter down the screen.
      if (cell.offsetTop !== rowTop) {
        rowTop = cell.offsetTop;
        const bar = el.root.querySelector<HTMLElement>(".player-bar")!;
        const top = el.bars.offsetTop + cell.offsetTop - bar.offsetHeight - el.root.clientHeight * 0.18;
        el.root.scrollTo({ top: Math.max(top, 0), behavior: reduceMotion() ? "auto" : "smooth" });
      }
    }
    markBeat(Math.max(beat, 0));
  }

  function click(at: number, accent: boolean) {
    if (!audio || !el.click.checked) return;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  function tick() {
    const beat = position();
    if (beat >= totalBeats) {
      pause();
      anchorBeat = 0;
      show(0);
      el.root.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
      return;
    }
    el.count.hidden = beat >= 0;
    if (beat < 0) el.count.textContent = String(Math.ceil(-beat));
    show(beat);
    if (audio) {
      // Schedule clicks a little ahead on the audio clock (steady timing).
      const secondsPerBeat = 60 / bpm();
      while (anchorTime + (nextClick - anchorBeat) * secondsPerBeat < audio.currentTime + 0.12) {
        const at = anchorTime + (nextClick - anchorBeat) * secondsPerBeat;
        const k = stepAt(Math.max(nextClick, 0));
        const downbeat = nextClick < 0 ? nextClick === -steps[0]!.beats : steps[k]!.start === nextClick;
        if (at >= audio.currentTime - 0.01) click(at, downbeat);
        nextClick++;
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function anchor(beat: number) {
    anchorBeat = beat;
    anchorTime = clock();
    nextClick = Math.ceil(beat);
  }

  async function play() {
    if (!steps.length) return;
    if (!audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try {
        audio = Ctx ? new Ctx() : null;
      } catch {
        audio = null;
      }
    }
    await audio?.resume().catch(() => undefined);
    // Count in one measure before the first beat.
    const from = steps[stepAt(Math.max(anchorBeat, 0))]!;
    playing = true;
    anchor(Math.max(anchorBeat, 0) === 0 ? -from.beats : from.start - from.beats);
    el.play.textContent = "一時停止";
    el.play.setAttribute("aria-pressed", "true");
    try {
      wakeLock = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null;
    } catch {
      wakeLock = null;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    anchorBeat = Math.max(position(), 0);
    playing = false;
    cancelAnimationFrame(frame);
    el.count.hidden = true;
    el.play.textContent = "再生";
    el.play.setAttribute("aria-pressed", "false");
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  }

  function seek(k: number) {
    const beat = steps[k]?.start ?? 0;
    if (playing) anchor(beat);
    else anchorBeat = beat;
    el.count.hidden = true;
    show(beat);
  }

  function setBpm(value: number) {
    const beat = position();
    el.bpm.value = String(Math.round(Math.min(Math.max(value, 30), 300)));
    if (playing) anchor(beat);
  }

  el.play.addEventListener("click", () => (playing ? pause() : void play()));
  el.slower.addEventListener("click", () => setBpm(bpm() - 4));
  el.faster.addEventListener("click", () => setBpm(bpm() + 4));
  el.bpm.addEventListener("change", () => setBpm(bpm()));
  el.click.addEventListener("change", () => store.set(CLICK_KEY, el.click.checked ? "1" : "0"));
  el.smaller.addEventListener("click", () => {
    zoom = Math.max(0.7, Math.round((zoom - 0.15) * 100) / 100);
    store.set(ZOOM_KEY, String(zoom));
    applyZoom();
    fit();
    rowTop = -1;
  });
  el.larger.addEventListener("click", () => {
    zoom = Math.min(2, Math.round((zoom + 0.15) * 100) / 100);
    store.set(ZOOM_KEY, String(zoom));
    applyZoom();
    fit();
    rowTop = -1;
  });
  el.bars.addEventListener("click", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".bar");
    if (cell) seek(Number(cell.dataset.k));
  });
  el.bars.addEventListener("keydown", (e) => {
    const cell = (e.target as Element).closest<HTMLElement>(".bar");
    if (cell && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      seek(Number(cell.dataset.k));
    }
  });
  el.close.addEventListener("click", () => close());
  el.feel.addEventListener("click", (e) => {
    const value = Number((e.target as Element).closest<HTMLElement>("[data-feel]")?.dataset.feel);
    if (value === 4 || value === 8 || value === 16) setFeel(value);
  });
  addEventListener("keydown", (e) => {
    if (el.root.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === " " && !(e.target as Element).closest?.(".bar, input, button")) {
      e.preventDefault();
      if (playing) pause();
      else void play();
    }
  });
  // Re-place the current line after the layout changes (rotation, resize).
  addEventListener("resize", () => {
    if (el.root.hidden) return;
    fit();
    rowTop = -1;
    const k = current;
    current = -1;
    if (k >= 0) show(Math.max(position(), steps[k]!.start));
  });

  function open(next: GtsDocument) {
    doc = next;
    el.bpm.value = String(Math.round(next.meta.tempo ?? 80));
    feel = next.meta.beat ?? 4;
    anchorBeat = 0;
    el.root.hidden = false;
    document.body.classList.add("in-player");
    build();
    setFeel(feel);
    el.root.scrollTo({ top: 0 });
    show(0);
    el.play.focus();
  }

  function close() {
    pause();
    el.root.hidden = true;
    document.body.classList.remove("in-player");
  }

  return { open, close };
}
