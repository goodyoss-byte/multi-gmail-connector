# Contributing

Thanks for helping! This project is a **local-first, read-only** MCP connector. Contributions that keep it small, private and safe are very welcome.

## Ground rules
- **Never commit credentials.** No OAuth client JSON files, tokens, `.env` files, real `config.json` or `secrets.enc.json`. `.gitignore` covers the usual names, but check `git status` before committing.
- **No real personal data** in tests, fixtures, issues or screenshots. Use made-up addresses like `a@example.com`.
- **Read-only stays read-only.** PRs that add sending, deleting, labelling or any other write capability need an issue and design discussion first (see ADR-0005).
- **No new network destinations or telemetry.** The connector talks only to Google's OAuth and Gmail endpoints (see docs/PRIVACY.md).
- **Keep dependencies minimal.** Explain why in the PR if you add one.

## Development
```bash
npm install          # installs and builds
npm run typecheck
npm test             # unit + integration + stdio end-to-end (no network, no real accounts)
```
Tests use a fake Google (`tests/helpers/fake-google.ts`). New behaviour needs tests. Security-relevant changes (OAuth, secrets, account isolation, tool output, content sanitisation) must add or extend tests in the matching suite (see docs/TESTING.md).

Code style: TypeScript strict mode, ES modules, small focused modules, comments that explain *why*. Logs go to stderr via `src/util/logger.ts`; never `console.log` in server code (stdout is the MCP channel).

## Licence of contributions
This project is licensed under **AGPL-3.0-only**. By submitting a contribution (a pull request, a patch, or code in an issue) you confirm that it is your own work or that you have the right to submit it, and you license it under AGPL-3.0-only **and** grant the maintainer a perpetual, worldwide, royalty-free, irrevocable, non-exclusive licence to use, reproduce, modify, sublicense and distribute it under other terms as well, so the project can also be offered as a differently licensed edition (for example a future hosted service). You keep the copyright in your own contribution.

If you would rather not grant that second licence, say so in the pull request. The contribution can still be discussed, and either carried as an AGPL-only patch or reimplemented.

## Pull requests
1. Open an issue first for anything non-trivial.
2. Keep PRs focused; describe what changed and how you tested it.
3. CI must pass on Linux, macOS and Windows (typecheck, tests, production `npm audit`, `npm pack`).
4. Update the docs (README / `docs/`) and add an ADR in `docs/adr/` for design decisions.

## Reporting bugs
Use the bug report template. Include `cmec doctor` output **after checking it contains nothing private** (it prints labels and addresses, never tokens or email content). For security issues, follow [SECURITY.md](SECURITY.md) instead.
