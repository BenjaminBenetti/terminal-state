# Meshy MCP server (project `.mcp.json`)

Claude Code's **project-scope** MCP configuration is the repo root file `.mcp.json` (that exact name, with the leading
dot; a plain `mcp.json` is not read). The Meshy entry for it is `docs/meshy.mcp.json`:

```json
{
  "mcpServers": {
    "meshy": {
      "command": "npx",
      "args": ["-y", "@meshy-ai/meshy-mcp-server@0.6.6"],
      "env": { "MESHY_API_KEY": "${MESHY_API_KEY}" }
    }
  }
}
```

| | |
|---|---|
| server name | `meshy` (stdio) |
| package | official [`@meshy-ai/meshy-mcp-server`](https://github.com/meshy-dev/meshy-mcp-server), pinned to 0.6.6 (npm `latest` on 2026-10-29); needs Node.js ≥ 18 |
| key | `${MESHY_API_KEY}`, read from the environment; no literal key, no default |

It isn't a game dependency: `package.json` / the lockfile, the build and GitHub CI don't use it. To upgrade, change
the pinned version deliberately.

## Project configuration

The repo already includes the project `.mcp.json`. `docs/meshy.mcp.json` is a matching reference template; no copy
step is needed after cloning this repo. The project entry was registered using Claude Code's supported
`claude mcp add-json --scope project` command, with the API key represented only by `${MESHY_API_KEY}`.

The server still requires the environment key and project-server approval below. Configuration alone does not
mean authentication has been verified. The config regression test checks both files for environment-only keys.

## The API key never goes in the repo

`${MESHY_API_KEY}` is Claude Code's environment-variable expansion in `.mcp.json`. Claude Code also supports
`${VAR:-default}`, but there is deliberately no default here. When Claude Code starts the server, it replaces the
placeholder with the value of `MESHY_API_KEY` **from the environment Claude Code itself was started in**. If the
variable is missing, Claude Code reports a missing-environment-variable error for this server, and the server has no
key.

**`.env` is not loaded automatically.** Claude Code does not read a `.env` file just because one exists. `.env`
and `.env.*` are git-ignored, but putting the key there does nothing by itself. The variable has to be exported in
the shell or worker that launches `claude`, for example:

```sh
# type / paste the key without echoing it and without it landing in shell history
read -rs MESHY_API_KEY && export MESHY_API_KEY
claude          # start Claude Code from this same shell
```

Better still, inject it from a secret manager, or from the dev container's or worker's secret environment, into
Claude Code's startup environment.

- **Never** put it in `.mcp.json`, in any committed file, or on a command line that shell history stores.
- **Never** use `VITE_*` variables, `game/public/`, the built site or anything shipped to browsers.
- **Never** put it in GitHub Actions; the game's CI does not need Meshy.

After setting the key, restart or reload Claude Code. The first time, Claude Code asks you to
approve the project's `meshy` server (project servers need approval); `/mcp` shows its status. Until then the server is
**not connected**.

## Using it

Configuring the server authorizes **no paid generation**. Meshy jobs (models, textures, images) cost money and
produce assets. Each one needs explicit user approval with a budget. Results go through the repository's normal
asset rules:
- keep the original download unchanged in the independent raw-asset backup;
- write provenance JSON under `game/public/assets/derivatives/`;
- build derivatives with the standard builder scripts;
- update the public-input allowlist (`tools/release/public-inputs.json`) only for an approved asset change.

New assets then flow through the loading-screen warm-up automatically (`docs/rendering-warmup.md`).
