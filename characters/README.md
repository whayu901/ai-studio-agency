# Characters

Each character lives in its own folder:

```
characters/<character_id>/
├── character.json      # profile (tracked in Git)
└── references/         # private images (NOT tracked — see .gitignore)
```

`registry.json` lists every character. Validate after every change:

```bash
python3 tools/validate.py characters
```

The validator refuses:

- a reference path outside the character's own `references/` folder
- the same image path, or the same image content (SHA-256), used by two characters
- an `active` character without front + close-up images, a human-written
  `physical_description`, and `commercial_use.authorized: true`
- reference files listed in the profile but missing on disk (warning while `placeholder`,
  error once `active`)

## Image naming (recommended)

`<character_id>_<view>_<nn>.<ext>` — for example `female_02_front_01.jpg`,
`female_02_closeup_01.jpg`. The name is a convention. What counts is the path listed in
`character.json`.

## Adding a new character

1. `mkdir -p characters/female_03/references` and copy an existing `character.json` into it.
2. Change `character_id`, `display_name` and every `female_0X` mention inside the file.
3. Add `{ "character_id": "female_03", "profile": "characters/female_03/character.json" }` to
   `registry.json`.
4. Run `python3 tools/validate.py characters`.
