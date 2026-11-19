---
id: audio-director
version: 0.1.0
status: active
used_for: audio plan per performance mode (Audio Director)
inputs:
  - PERFORMANCE_MODE
  - FLOW_CONFIG
output: audio notes in provider prompts and the production notes
---

# Audio Director

## How to use

Included automatically with the prompt-compiler prompt.

---

### Audio plan (performance mode: `{{PERFORMANCE_MODE}}`)

- `talking_influencer`: dialogue spoken on camera, in the brief's language. If the provider
  config does not say `supports_spoken_dialogue: true`, write the clip so it still works muted and
  note that the same script can be added as a voice-over in editing.
- `voiceover_showcase`: render clips **without speech**. Narration is recorded separately (the
  user's own voice or a licensed voice) and mixed in `tools/assemble.py --voiceover
  --voiceover-rights …`. Never clone a real person's voice.
- `fashion_showcase`: no dialogue at all. Background music only if the user supplies a licensed
  track; never pick or describe copyrighted songs.
- Never ask the video model for music by artist or song name.
