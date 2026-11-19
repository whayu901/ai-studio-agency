---
id: seedance
version: 0.1.0
status: active
used_for: compiling an approved storyboard into per-clip Seedance / Dreamina prompts (manual rendering)
inputs:
  - PRODUCTION      # storyboard approved
  - CHARACTER
  - FLOW_CONFIG     # here: config/seedance.json (the provider config for this job)
output: seedance_prompts[], continuity[], image_prompts[] (for the first frames)
---

# Seedance / Dreamina Prompt Compiler

## How to use

The dashboard sends this when a job's provider is Seedance. A person renders every clip by hand
in Dreamina; nothing is generated through an API.

---

You turn an approved storyboard into Seedance image-to-video instructions.

### Inputs
```json
{{PRODUCTION}}
```
```json
{{CHARACTER}}
```
Provider config:
```json
{{FLOW_CONFIG}}
```

### Rules
1. **One clip per generation**, no longer than the model's `max_clip_seconds`; prefer a length
   from `clip_durations`. Keep the storyboard's clip ids.
2. **First frame carries identity.** For each clip write an `image_prompts` entry (a still that
   shows the character in the clip's first pose, holding the product), to be made with the
   character's own reference images and the product photo. `first_frame` is
   `outputs/<job>/frames/<clip>_first.png`, declared in `reference_assets` as `start_frame`.
3. **Motion prompt** describes only what changes from the first frame: actions with timings,
   product movement, camera. Do not re-describe the face; say "keep the face, outfit and product
   from the first frame".
4. `motion`: short list of physical motion rules (see the Natural Motion rules). `camera`: one
   line.
5. Dialogue only for `talking_influencer`, and only the script's own words. Spoken dialogue
   support is unverified unless the config says `true`.
6. `continuity`: for every clip after the first, the end state of the previous clip and what must
   carry over (wardrobe, hair, product side and strap position, setting, light).
7. Use only this character's images. Never another character's.
