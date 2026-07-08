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

If no score has been selected yet, the score panel shows instructions for
getting a PDF onto the headset and opening the picker.

## Getting sheet music onto the headset

No PC tooling is required. Either:

- **Headset browser**: open the Quest browser, download your PDF (e.g. from
  Google Drive or an email attachment). Downloads land in the `Download`
  folder.
- **USB drag & drop**: connect the headset to a PC (allow the connection in
  the headset), open it as a drive and drop PDFs into `Download` or
  `Documents`.

## Choosing a score in the app

1. Press the left controller **Menu** button to open the score picker.
2. On first use the picker asks for file access: press **A** to open the
   system settings, enable **"Allow management of all files"**, and return to
   the app. This is needed because Android's scoped storage does not let apps
   read PDFs from shared folders otherwise (see docs/design ADR-007).
3. Move the highlight with the **right thumbstick**, load with **A**, cancel
   with **B**. The picker lists all PDFs in the `Download` and `Documents`
   folders.

The app remembers your selection and reopens the same score next time.

## Controls

| Input | Action (score mode) | Action (picker open) |
| --- | --- | --- |
| Right controller A | Next page | Load highlighted score |
| Right controller B | Previous page | Close the picker |
| Right thumbstick up / down | BPM +5 / -5 (flick once per step) | Move the highlight |
| Left controller X | Start / stop the metronome | — |
| Left controller Y | Recenter the panels in front of you | Recenter |
| Left controller Menu (☰) | Open the score picker | Close the picker |

## Practice flow

1. Put on the headset, launch GuitarMR, and pick up your guitar.
2. Press **Menu** and choose your score if it is not already showing.
3. Sit or stand where you want to practice and press **Y** to place the
   panels comfortably in front of you.
4. Set the tempo with the right thumbstick (30–300 BPM, default 90).
5. Press **X** to start the metronome. Beat 1 of each bar has a higher
   pitched, red-highlighted accent.
6. Turn pages with **A**/**B** as you play.

## Tips

- The panels are world-anchored: they stay put when you look down at your
  hands. Press **Y** whenever you move to a new spot.
- The metronome keeps its beat phase when you change tempo, so you can nudge
  the BPM while playing without the count restarting.
- Panel too low/high? Recenter (**Y**) while looking straight ahead; the
  panels are placed slightly below eye level for a natural reading angle.
