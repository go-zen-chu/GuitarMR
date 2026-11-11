# Design Decisions

This directory records the design decisions made for GuitarMR and the
reasoning behind them, in ADR (Architecture Decision Record) style. ADR
numbers are shared across the files and never reused.

## MR app (Quest 3): [mr.md](mr.md)

- ADR-001: Use Unity official packages only, not the Meta XR SDK
- ADR-002: Render PDFs on-device with the Android platform API
- ADR-003: Schedule metronome clicks on the audio DSP clock
- ADR-004: Layered architecture with runtime scene composition
- ADR-005: Controller-button input instead of ray/poke UI interaction
- ADR-006: Use the legacy built-in font UI text
- ADR-007: In-app score picker using "all files access"

## Web and Android app (tky): [web-app.md](web-app.md)

- ADR-008: Canonical JSON format (gts, Guitar Tab Score) for digitized handwritten tabs
- ADR-009: Digitize and view on phone/tablet as a client-only PWA in TypeScript
- ADR-010: Ship the phone page as an Android app wrapping it in a WebView
- ADR-011: Lower the cost of reading with Claude without lowering its quality

## Other design notes

- [tab-digitization.md](tab-digitization.md): the gts format in detail (ADR-008)
