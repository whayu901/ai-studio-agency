# Character registry

`characters/registry.json` lists characters; each has `characters/<id>/character.json`
(schema `schemas/character.schema.json`) and private images in `characters/<id>/references/`
(git-ignored).

| Character | Status (2026-11-19) |
|---|---|
| `female_01` | placeholder — no references, no description; jobs can be planned but not rendered |
| `female_02` | active — 5 references, human-approved description, commercial use recorded |

## Rules (enforced by `tools/validate.py`)

- A production uses exactly one `character_id`; references must be under that character's folder.
- The same file path or identical file content (SHA-256) may not appear for two characters.
- `active` requires front and close-up references, a human-written `physical_description`, and
  `commercial_use.authorized = true` with a rights holder; expired authorizations are errors.
- A missing or invalid character stops the job. The app never substitutes another character.
- If `physical_description` is null, prompts describe the character only as "the woman in the
  attached reference images".

## In the app

The Characters page shows each character's images (served to the local dashboard only), appearance,
wardrobe, accessories, distinguishing details, allowed variations and commercial-use status.
Reference images are never copied into delivery packages; the package's `character-manifest.json`
lists the id, approved description, wardrobe and identity rules, and `asset-manifest.json` lists the
reference files by path and SHA-256 only.

## Adding a character

Follow README §4: add images to `characters/<new_id>/references/`, write `character.json`, add the
entry to `registry.json`, then `python3 tools/validate.py characters`. The dashboard picks it up on
the next page load.
