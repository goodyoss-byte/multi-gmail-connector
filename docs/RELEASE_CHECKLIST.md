# Public release checklist

The owner approved publication on 6 Oct 2026 for v0.2.0. The state below is as of that release; re-run the automated section before every release.

## Automated (re-run right before release)
- [x] `npm ci && npm run build && npm run typecheck && npm test`: all green (113 tests).
- [x] `npm audit --omit=dev --audit-level=high`: no findings. Dev-only advisories are not audited; they never reach users.
- [ ] Secret scan of the **working tree and full git history** (e.g. `gitleaks detect --log-opts="--all"` or `trufflehog git file://.`), plus `git log -p --all | grep -nE 'ya29\.|1//0|GOCSPX-|client_secret"\s*:'` → nothing but test fixtures and documentation patterns.
- [ ] `git ls-files` contains no `client_secret*.json`, `.env`, `config.json` from a real install, or `secrets.enc.json`.
- [x] Licences of runtime dependencies are AGPL-compatible: 13 MIT, 5 BSD-2-Clause, 1 BSD-3-Clause.
- [x] GitHub Actions in `.github/workflows/ci.yml` pinned to commit SHAs.

## Owner decisions
- [x] **Git history.** Published from a fresh single commit; the private repository keeps the earlier hosted/SaaS design history.
- [x] **Licence.** AGPL-3.0-only ("only", not "or later") chosen by the owner (canonical GNU text in `LICENSE`, SPDX headers in `src/`).
- [x] **Copyright holder name.** "goodyoss-byte" confirmed by the owner.
- [x] **CLA.** No signed CLA: `CONTRIBUTING.md` carries an inbound AGPL licence plus a dual-licensing grant, with an opt-out stated in the pull request.
- [ ] **Security contact.** `SECURITY.md` points to GitHub private vulnerability reporting. Enable it (Settings → Code security → Private vulnerability reporting), or add an email address.
- [ ] Repository description, topics, and whether to enable Discussions.

## Manual verification (real accounts; owner)
- [ ] Clean machine or VM: `npm install -g multi-gmail-connector` then `cmec setup`, following only the README.
- [ ] Google Cloud setup following docs/GOOGLE_CLOUD_SETUP.md exactly; note any Console label changes.
- [x] First real account connected on Windows (owner, 2026-09-27): test-user and Data Access steps were needed; the Gmail permission appears on a second consent screen.
- [ ] Connect Gmail #1 and #2 (and #3); the unverified-app screen appears once per account; the "View your email messages and settings" box is ticked.
- [x] `cmec doctor` passes (Windows).
- [ ] Claude Code: registered by `cmec install`; ask "Search all my connected inboxes for ..."; each result names its account.
- [x] Claude Desktop on Windows: config merged, restart, connector working with a real Gmail account (owner, 2026-09-27).
- [ ] "Check all my inboxes for unread emails from this week that look important" → results labelled per account.
- [ ] Revoke one account at myaccount.google.com/permissions → Claude reports "needs reconnect" for it only → `reconnect` fixes it.
- [ ] `remove` and `uninstall` remove keychain entries (check Keychain Access / Credential Manager / `secret-tool`).
- [ ] Check Claude's MCP log: no email content, queries or tokens.

## Review
- [ ] Security review of `src/oauth`, `src/secrets`, `src/accounts`, `src/mcp` (fresh eyes or `/security-review`).
- [ ] Privacy review against docs/PRIVACY.md.
- [ ] README read-through by someone non-technical.

## Still open after v0.2.0
- macOS and Linux have only been exercised by CI, never by a real-account setup. The README says so.
- [x] `npm publish` of `multi-gmail-connector`; v0.2.0 tagged and released on GitHub.
- Private vulnerability reporting enabled on the public repository; repository description and topics set.

## Publishing a later release
The public repository (`goodyoss-byte/multi-gmail-connector`) has its own linear
history that starts at v0.2.0; the private repository keeps the full history.
The local `public-release` branch tracks what the public repository holds, so a
later release never needs a force-push:

```bash
git checkout public-release
git checkout main -- .          # take main's tree, not its history
git add -A && git commit        # one commit per public release
git push public public-release:main
```
Then tag **the public commit by name** and push that tag:
```bash
git tag -a vX.Y.Z -m "…" public-release     # the branch name is not optional
git push public refs/tags/vX.Y.Z
git checkout main
```
`git tag` with no target tags whatever HEAD happens to be. On 6 Oct 2026 that
tagged `main` instead, and pushing the tag carried main's entire private
history into the public repository; the fix was deleting and recreating it.
Safer still: push the branch first, then create the tag through the API against
the SHA the public repository now has:
```bash
gh api -X POST repos/<owner>/<repo>/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<sha of public main>
```
Then `npm publish` from `main` (`prepublishOnly` re-runs typecheck and tests
first, and `prepare` builds the package).
