@AGENTS.md

## Claude Code specifics

- Project settings live in `.claude/settings.json` (shared). Personal overrides go in
  `.claude/settings.local.json`, which is gitignored.
- Commit and PR attribution is disabled in settings; keep it that way (see AGENTS.md).
- Prefer the dedicated Read/Edit/Grep tools over shell equivalents; use `just` for project commands.
