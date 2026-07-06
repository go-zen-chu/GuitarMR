# Usage Guide

How to use GuitarMR on a Meta Quest 3 once the app is installed
(see docs/development for building and installing).

## What you see

The app runs in passthrough: you see your real room and your guitar. Two
panels float about 1.1 m in front of you:

- **Score panel** (top): one page of your sheet music with a page counter.
- **Metronome panel** (bottom): current BPM, RUNNING/STOPPED state, a beat
  indicator (the first beat of each bar lights up red, others orange), and a
  controls hint.

If no score has been transferred yet, the score panel shows instructions with
the exact device path to push your PDF to.

## Transferring your sheet music

1. Launch the app once so it creates its data directory.
2. Connect the headset via USB (allow the connection in the headset) and run:

   ```sh
   adb push your-score.pdf /sdcard/Android/data/com.gozenchu.guitarmr/files/Scores/
   ```

3. Restart the app. The first PDF (alphabetical order) in the folder is
   rendered.

Notes:
- PNG/JPG images in the same folder are used as pages (sorted by file name)
  when no PDF exists — useful for scores you only have as images.
- To switch songs, remove or rename PDFs so the one you want comes first
  alphabetically, then restart the app. A file picker is a planned feature
  (see docs/project).

## Controls

| Input | Action |
| --- | --- |
| Right controller A | Next page |
| Right controller B | Previous page |
| Right thumbstick up / down | BPM +5 / -5 (flick once per step) |
| Left controller X | Start / stop the metronome |
| Left controller Y | Recenter the panels in front of you |

## Practice flow

1. Put on the headset, launch GuitarMR, and pick up your guitar.
2. Sit or stand where you want to practice and press **Y** to place the
   panels comfortably in front of you.
3. Set the tempo with the right thumbstick (30–300 BPM, default 90).
4. Press **X** to start the metronome. Beat 1 of each bar has a higher
   pitched, red-highlighted accent.
5. Turn pages with **A**/**B** as you play.

## Tips

- The panels are world-anchored: they stay put when you look down at your
  hands. Press **Y** whenever you move to a new spot.
- The metronome keeps its beat phase when you change tempo, so you can nudge
  the BPM while playing without the count restarting.
- Panel too low/high? Recenter (**Y**) while looking straight ahead; the
  panels are placed slightly below eye level for a natural reading angle.
