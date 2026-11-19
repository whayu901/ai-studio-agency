# Seedance / Dreamina (manual)

Seedance is used by hand in Dreamina's web UI. **No API integration exists**, and none is faked.

Capabilities live in `config/seedance.json` (schema `schemas/seedance-config.schema.json`). The
committed values are **unverified starters**: model `seedance-web`, image-to-video and
text-to-video, max 10 s, offered lengths 5/10 s, 1 reference image (the first frame), 9:16 / 16:9 /
1:1, spoken dialogue unknown. Check them in Dreamina and edit the file.

Workflow for a Seedance job:

1. Prompt Studio → **Image generation**: copy each clip's first-frame prompt, make the still with an
   image tool you are licensed to use, attaching only this character's references and the product
   photo.
2. Upload the still with **Upload first frame**. Until every clip has one, the readiness check
   blocks rendering ("asset file … is missing on disk").
3. Prompt Studio → **Seedance**: per clip the motion prompt (only what changes from the first
   frame), motion notes, camera, avoid list, and continuity notes.
4. In Dreamina: image-to-video, upload the first frame, paste the prompt, choose length and aspect
   ratio; render; download; upload on **Render & QC**.

If a clip's planned length is not an offered length, the validator warns: render the next longer
length; `assemble.py` trims it in the final edit.

A future API integration must implement `ApiVideoProvider` (`web/src/server/providers/video.ts`:
submit, poll, fetch result, record cost) and only after its official API, pricing and credentials
have been verified.
