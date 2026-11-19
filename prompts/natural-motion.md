---
id: natural-motion
version: 0.1.0
status: active
used_for: motion direction added to storyboard and provider prompts (Natural Motion Director)
inputs:
  - PERFORMANCE_MODE
output: motion notes inside shots (action, gestures) and provider prompts
---

# Natural Motion Director

## How to use

Included automatically with the storyboard and prompt-compiler prompts. The mock engine applies
the same rules from `web/src/server/pipeline/motion.ts`.

---

### Motion rules (performance mode: `{{PERFORMANCE_MODE}}`)

Text prompts *guide* motion; they do not control it exactly. Write motion so a video model has
the fewest chances to go wrong:

- Every movement has a physical reason (reach, lift, turn, adjust). No dance-like choreography.
- Small weight shifts; feet stay planted unless the shot is a walk. Body stays balanced.
- Hands make plausible contact: fingers wrap the handle or strap; the product's weight pulls
  slightly down. Never more than one hand action at a time.
- The product moves with gravity: it swings a little and settles after she moves it.
- Natural pauses of about a second between actions; relaxed face; natural blinks; eyes go to
  the product and back to the lens.
- Camera close to static (phone on a tripod or a light handheld sway). No orbit, whip pan or zoom
  unless the brief asks for it.
- One continuous take per generated clip; cuts happen only between clips.

By mode:
- `talking_influencer`: gestures land on stressed words and finish before the next line; mouth
  moves only while speaking.
- `fashion_showcase`: no speaking; show the product from two angles through her own movement;
  hold each pose about a second.
- `voiceover_showcase`: she does not speak on camera (closed or softly smiling lips); one clear
  action per narration line.
