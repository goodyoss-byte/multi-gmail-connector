# Google Cloud setup (step by step)

You create **your own** Google Cloud project and OAuth client. It takes about 10 minutes, is free, and means nobody else, including the authors of this project, ever handles your Google credentials.

> Google renames Console menus from time to time. The steps below use the current names ("Google Auth Platform" → Branding / Audience / Data Access / Clients) and the older ones ("OAuth consent screen", "Credentials") in brackets. The exact labels were **not re-verified** for this release; if a label differs, look for the nearest equivalent.

## 1. Create a Google Cloud project
1. Open https://console.cloud.google.com/ and sign in with **any** Google account. It doesn't have to be one of the mailboxes you'll connect.
2. Project picker → **New project** → name it e.g. `claude-email-connector` → **Create**.
3. Make sure the new project is selected at the top of the page.

No billing account is needed for the Gmail API at personal-use volumes.

## 2. Enable the Gmail API
1. **APIs & Services → Library**.
2. Search for **Gmail API** → open it → **Enable**.

## 3. Configure the OAuth consent screen
1. Open **Google Auth Platform** [or *APIs & Services → OAuth consent screen*] and click **Get started** if asked.
2. **Branding / App information:** App name e.g. `My Claude Email Connector`; User support email: your address. Developer contact: your address. Save.
3. **Audience:** User type **External**.
4. **Test users** (after the initial form, under **Audience**): add every Gmail address you plan to connect (personal, business, accounting…).
5. **Data Access** (recommended): **Add or remove scopes** → filter `gmail.readonly` → tick `https://www.googleapis.com/auth/gmail.readonly` → **Update** → **Save**. The app requests only this scope plus `openid` and `email`. In real-world setup, the Gmail permission didn't reliably appear on Google's consent screen until this scope was listed here.

### Testing or In production?
| Publishing status | What happens |
|---|---|
| **Testing** — *recommended for personal use* | Only the test users you list (step 3.4) can connect. No verification and no website needed. **Google expires Gmail sign-ins after 7 days**, so run `cmec reconnect <label>` about once a week (about 30 seconds per account). |
| **In production** (not verified) | No weekly re-sign-in. But the **Publish app** button stays disabled until the Branding page has an **application home page, privacy policy link and authorised domain** — a website on a domain you own. Google then shows a "Google hasn't verified this app" screen once per account. |

For personal use, stay in **Testing**. On the Branding page, **don't upload a logo**: the Console warns that a logo requires submitting the app for verification unless it's in Testing. Leave the home-page, privacy-policy, terms and authorised-domain fields empty.

Where to add test users: **Google Auth Platform → Audience → Test users → + Add users**. The initial "Get started" form doesn't ask for them. **Add your own address too**: being the project owner isn't enough. Otherwise sign-in fails with "Access blocked … has not completed the Google verification process (Error 403: access_denied)".

## 4. Create the OAuth client (Desktop app)
1. **Clients** [or *APIs & Services → Credentials*] → **Create client** [*Create credentials → OAuth client ID*].
2. **Application type: Desktop app.** Not "Web application".
3. Name: e.g. `claude-email-connector-desktop` → **Create**.
4. **Before clicking OK**, click **Download JSON**. The dialog warns that the secret can't be viewed or downloaded again once it's closed. The file is named like `client_secret_XXXX.apps.googleusercontent.com.json`.
5. **Don't screenshot or share this dialog**: it shows the client secret. If it's ever exposed, open the client under **Clients**, add a new secret, then disable and delete the old one.

Keep this file private. Don't commit it, email it or paste it into chats (including AI chats). The setup wizard reads it once and offers to delete it.

## 5. Redirect URIs
**Nothing to add.** Desktop-app clients accept loopback redirects (`http://127.0.0.1:<random port>`) automatically. The connector opens a one-time listener on your computer only while you sign in.

## 6. Configure the connector
In the project folder:
```bash
npm install
cmec setup
```
The wizard:
1. checks Node.js (≥ 22) and that your OS keychain works;
2. asks for the path to the JSON file from step 4 (you can drag the file into the terminal), stores the client ID in the config file and the client secret in your keychain, then offers to delete the file;
3. offers to connect accounts (next step).

Already configured and only want to replace the client? `cmec set-client /path/to/client_secret.json`

## 7. Connect Gmail account #1
The wizard (or `cmec add --label Personal`) opens your browser:
1. Choose the Google account, e.g. `personal@gmail.com`.
2. If you see **"Google hasn't verified this app"**: this is expected, because it's your own app. Click **Advanced → Go to <your app name> (unsafe)**.
3. On the permission screen, click **Select all** or tick **"View your email messages and settings"** (Google shows each permission as a checkbox and they can start unticked), then **Continue**. If it isn't ticked, the connector refuses to save the account and cancels the sign-in at Google.
4. The browser says "Account connected"; the terminal prints `✔ Connected personal@gmail.com as "Personal"` and `✔ Gmail read access works`.

## 8. Connect Gmail account #2 (and #3…)
```bash
cmec add --label Business
cmec add --label Accounting
```
In the account chooser, **pick the other account** (use "Use another account" if it isn't listed). Connecting the same Google account twice just refreshes it; it doesn't create a duplicate.

Check the list:
```bash
cmec list
```

## 9. Test multi-account search
1. `cmec doctor`. Every line should show ✔. It checks each account's token and Gmail access without showing any email content.
2. Add the server to Claude: `cmec claude-config` prints the exact command for Claude Code and the JSON for Claude Desktop (see README → *Add to Claude*).
3. In Claude, ask: **"Search all my connected inboxes for my Emirates flight confirmation."** Each result names the account (label and address) it came from.

## 10. Revoke access
- One account: `cmec remove Business`. This revokes the token at Google and deletes it from your keychain.
- At Google directly (for example from another device): https://myaccount.google.com/permissions → your app → **Remove access**. The connector then reports that account as "needs reconnect".

## 11. Remove all stored credentials
```bash
cmec uninstall
```
This revokes every account at Google, deletes all keychain entries (service `multi-gmail-connector`), the client secret and the config file. Then:
- remove the `email` server from Claude (`claude mcp remove email`, or delete it from `claude_desktop_config.json`);
- optionally delete the Google Cloud project: Console → **IAM & Admin → Settings → Shut down**.

To inspect the keychain manually: macOS *Keychain Access* (search `multi-gmail-connector`), Windows *Credential Manager → Windows Credentials*, Linux *Seahorse* / `secret-tool search service multi-gmail-connector`.

## Google Workspace (company) accounts
Workspace admins can block unverified apps or restricted scopes. If a work account shows "access blocked", your admin must allow the app (Admin console → Security → API controls → App access control) or you can't connect that account. Personal `@gmail.com` accounts aren't affected.
