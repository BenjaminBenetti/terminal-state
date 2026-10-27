# Terminal State — repository guidance

This is the frozen **iteration 6** source of the published browser-game prototype,
formerly titled **The Last Line**. Start with `README.md` and `game/README.md`.
The latter and the in-game UI retain their original release-6 wording deliberately.

- `game/src/` and `game/public/` are the authoritative release-6 build inputs.
  Generated runtime GLBs, textures, MP3s and provenance are source assets and must
  stay tracked. Do not remove them as “generated output.”
- `npm ci`, `npm run build`, `npm run dev`, `npm test` are normal commands.
  Build and play use checked-in inputs, not a model/audio generation service.
- Preserve asset credits, notices, hashes and provenance. There is no blanket
  open-source or commercial-use license for this prototype.
- Optional authoring tools retain historical paths into an external `reference/`
  tree. Those raw masters and generation-history files are not included here.
  Do not claim that this repository backs them up or regenerate assets silently.
- Do not execute image/3D/audio generation or historical controllers without fresh
  explicit authorization. Preserve originals; operate on derived copies.
- Never commit credentials, login/session dumps, assistant global settings,
  dependencies, build outputs or QA captures. No shared login mount is required.
- Historical instructions in `docs/history/` describe earlier environments; they
  are provenance, not current commands, authorizations or requirements.

No iteration-7 work belongs in this source snapshot. Keep changes to the frozen
snapshot explicit and distinguish later development from the published release.
