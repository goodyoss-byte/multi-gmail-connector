# Privacy

**This edition runs entirely on your computer.** The project's authors don't operate any server for it and receive nothing from it.

| Data | Leaves your computer? | Where it goes |
|---|---|---|
| Gmail password | Never asked for | — (you sign in on Google's own page) |
| OAuth tokens, client secret | No (only to Google when refreshing/revoking) | Your OS keychain |
| Email content, attachments | Only to Claude, when Claude calls a tool | Claude (under your Claude account's terms) |
| Search queries | To Google (Gmail API) and back | — |
| Usage data / telemetry | No | There is none |

Things to be aware of:
- **Claude sees what the tools return.** Anything a tool returns (subjects, snippets, bodies, attachment text) goes into your Claude conversation and is handled under Anthropic's terms for your plan.
- **Google** sees the API calls your own Google Cloud project makes, as for any Gmail app.
- **Your Google Cloud project** belongs to you. Nobody else can see its credentials or usage.
- **Logs** go to Claude's MCP log (stderr). They contain tool names, account ids, counts and timings, never email content, queries or tokens.

If any future feature would send data anywhere else, it must be documented here and be opt-in.
