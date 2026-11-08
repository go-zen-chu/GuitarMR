/**
 * A small plucked-string synthesizer for the play view (Web Audio): each
 * pitch is a Karplus-Strong string rendered once into a buffer, chords are
 * strummed string by string, dead notes are a short damped scratch.
 * Everything goes through one output that `stop` fades out, so pausing or
 * jumping silences what is still ringing.
 */

import type { SoundEvent } from "@guitarmr/gts";

/** Seconds between strings in a strum, and between notes picked together. */
const STRUM_GAP = 0.014;
const PICK_GAP = 0.004;
const RELEASE = 0.08;

export interface Synth {
  /** Render the strings these events need ahead of time (avoids a hitch at the first notes). */
  prepare(events: readonly SoundEvent[]): void;
  /** Sound `event` starting at audio time `at`, a beat lasting `secondsPerBeat`. */
  play(event: SoundEvent, at: number, secondsPerBeat: number): void;
  /** Fade out everything playing or scheduled. */
  stop(): void;
}

/** Create a synthesizer that plays into `audio`'s output. */
export function createSynth(audio: AudioContext): Synth {
  const buffers = new Map<string, AudioBuffer>();
  let output = newOutput();

  function newOutput(): GainNode {
    const gain = audio.createGain();
    gain.connect(audio.destination);
    return gain;
  }

  /** One plucked string at `midi`, ringing out (or damped at once when `muted`). */
  function string(midi: number, muted: boolean): AudioBuffer {
    const key = `${midi}${muted ? "x" : ""}`;
    const cached = buffers.get(key);
    if (cached) return cached;
    const rate = audio.sampleRate;
    const length = Math.floor(rate * (muted ? 0.07 : 2.4));
    const buffer = audio.createBuffer(1, length, rate);
    const out = buffer.getChannelData(0);
    const period = Math.max(Math.round(rate / (440 * 2 ** ((midi - 69) / 12))), 2);
    const line = new Float32Array(period);
    // A softened noise burst: the pick's attack without its hiss.
    let previous = 0;
    for (let i = 0; i < period; i++) {
      previous = line[i] = 0.5 * previous + 0.5 * (Math.random() * 2 - 1);
    }
    // Losses per trip along the string: higher strings fade sooner, as on a guitar.
    const decay = muted ? 0.6 : 0.996;
    for (let i = 0, at = 0; i < length; i++) {
      const next = at + 1 === period ? 0 : at + 1;
      out[i] = line[at]!;
      line[at] = decay * 0.5 * (line[at]! + line[next]!);
      at = next;
    }
    buffers.set(key, buffer);
    return buffer;
  }

  return {
    prepare(events) {
      for (const e of events) for (const n of e.notes) string(n, e.muted === true);
    },

    play(event, at, secondsPerBeat) {
      const notes = event.stroke === "up" ? [...event.notes].reverse() : event.notes;
      const gap = event.stroke ? STRUM_GAP : PICK_GAP;
      const level = (event.part === "chord" ? 0.22 : 0.34) / Math.sqrt(notes.length);
      const end = at + Math.max(event.length * secondsPerBeat, 0.05);
      notes.forEach((midi, i) => {
        const start = at + i * gap;
        const source = audio.createBufferSource();
        source.buffer = string(midi, event.muted === true);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(level, start);
        gain.gain.setValueAtTime(level, Math.max(end, start));
        gain.gain.linearRampToValueAtTime(0.0001, Math.max(end, start) + RELEASE);
        source.connect(gain).connect(output);
        source.start(start);
        source.stop(Math.max(end, start) + RELEASE + 0.02);
      });
    },

    stop() {
      const old = output;
      old.gain.setValueAtTime(old.gain.value, audio.currentTime);
      old.gain.linearRampToValueAtTime(0, audio.currentTime + 0.05);
      setTimeout(() => old.disconnect(), 200);
      output = newOutput();
    },
  };
}
