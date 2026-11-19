# Production modes

Two creation modes × three performance modes, all through the same pipeline and state machine.

## Creation modes

**Original Creation** — campaign form → brief → concepts → script (custom or drafted) →
storyboard → provider prompts → manual render → QC → package.

**Reference Guided** — as above, plus first:
1. Upload a reference video you own or are authorized to use, and record the rights basis
   (`owned`, `licensed`, `written_permission`, `internal_test_only`) and a note. Nothing is downloaded
   from platforms.
2. Frames are extracted with FFmpeg (1/s, at most 60, spread over the video) into
   `outputs/<job>/reference/` with a timestamped `manifest.json`.
3. Analysis: in **manual** mode export `reference-analysis.md` and attach the listed frames in order
   in Claude; in **mock** mode only metadata is recorded and every visual aspect is "unknown".
   Audio, exact dialogue, off-frame action and motion between frames are always listed as unknown.
4. Concepts include "Adapted structure from the reference" (borrow pacing/format only;
   `must_not_copy` lists script, people, logos, music, distinctive scenes).

## Performance modes

| | Talking Influencer | Fashion / Product Showcase | Voice-over Showcase |
|---|---|---|---|
| Character speaks on camera | yes | no | no |
| Script | custom (exact or editable) or drafted from verified claims | none (custom text kept for captions only) | narration, recorded separately |
| Shot `dialogue` | spoken lines | always null | narration lines (timing only) |
| Render prompt `dialogue` | the line(s) | null + "does not speak" | null + "does not speak" |
| Motion | gestures on stressed words | pose-hold-turn, product from 2 angles | one action per narration line |
| Audio | on-camera dialogue; voice-over fallback if unverified | licensed music added in editing | own or licensed voice via `assemble.py --voiceover --voiceover-rights` |
| QC categories | all 14 | no audio/dialogue/lip-sync | no dialogue/lip-sync |

## Scripts

- **Exact-script mode** (default for custom scripts): the words are copied unchanged. The validator
  rejects any change; the Script tab is read-only. Turn it off in the campaign to allow trimming.
- **Speech duration** is estimated at 2.0 words/s (Indonesian) / 2.3 (English) with ~1 s of silence
  per clip; the campaign form and Script tab warn when a script is likely too long.
- Sentences are never split across clips.

## Multi-clip ads

Durations are split into equal clips no longer than the provider's `max_clip_seconds`
(Flow config 8 s: 8 → 1, 16 → 2, 24 → 3, 30 → 4×7.5; Seedance config 10 s: 30 → 3×10). A continuity
manifest lists, for each cut, the previous clip's end state and what must carry over (face, hair,
wardrobe, product side and strap, setting and light). Consistent faces, perfect lip-sync and
seamless transitions are goals to check in QC, never guarantees.
