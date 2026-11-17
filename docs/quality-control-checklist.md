# Quality-control checklist (v0.1)

Score **every rendered clip** before anyone outside the team sees it. Write the scores into
`quality_checks[].score` in `outputs/<job>/production.json`, and the total into the experiment
log.

Watch each clip **three times**: at normal speed, at 0.25× speed (frame-by-frame for hands and
face), and with sound only. Use the same phone-sized window the audience will use.

## Scoring scale

| Score | Meaning |
|---|---|
| 5 | Indistinguishable from real footage / perfect match |
| 4 | Minor issue only a careful viewer would notice |
| 3 | Noticeable but acceptable for a test; fix before delivery if possible |
| 2 | Clearly wrong; viewers will notice |
| 1 | Unusable |

A clip **passes** only when every dimension meets its minimum. One fail = re-render or fix.

## Dimensions

| ID | Dimension | Min | What to look for |
|---|---|---|---|
| QC01 | Face consistency | 4 | Same face as the reference images in every frame: eye shape, nose, lips, brows, skin tone, apparent age. Pause at the start, middle and end, and compare side by side with the close-up reference. |
| QC02 | Body and wardrobe | 4 | Same proportions and the planned outfit throughout. No garments morphing, no new accessories, hair unchanged. |
| QC03 | Natural motion | 3 | Weight and timing feel human. No sliding, floating, rubbery limbs or sudden speed changes. |
| QC04 | Hands and fingers | 3 | Five fingers, plausible grip on the product, no fingers merging into the product, no extra hands. |
| QC05 | Product integrity | 4 | Exact shape, colour, lid and wordmark as in the product image; no warped or invented text; correct size relative to the hand. |
| QC06 | Camera realism | 3 | Believable smartphone footage: natural handheld movement, plausible focus and exposure, no "cinematic" grading unless planned. |
| QC07 | Speech accuracy | 3 | The spoken words match the script. Treat this as a **goal**, not a model guarantee. If speech is wrong, plan a voice-over. |
| QC08 | Lip-sync | 3 | Mouth movement matches the audio. If you replace the audio with a voice-over, re-score this against the voice-over. |
| QC09 | Visual artifacts | 4 | Flicker, warping background, melting edges, objects popping in or out, garbled text. |
| QC10 | Copyright and commercial-use clearance | 5 | Character has `commercial_use.authorized: true` for this use. Product images and any reference video have a recorded rights basis. No third-party logos, music or likenesses. Sample briefs always score 1 here. |

## Before commercial delivery (all must be true)

- [ ] Every clip passes every dimension
- [ ] Every claim in the final edit is in the brief's `verified_claims`
- [ ] Text overlays, prices and CTAs were added in editing and proofread
- [ ] No voice is cloned from a real person without written authorization
- [ ] Platform AI-content disclosure labels applied where required
- [ ] A named human reviewer has approved it (`human_review.reviewer` + `approved_on`)
- [ ] `python3 tools/validate.py production outputs/<job>/production.json` passes with status `APPROVED`
