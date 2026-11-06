English · [한국어](sync-setup.md) · [README](../README.en.md)

# Google Drive sync setup

Lasagna reaches Drive through **your own Google Cloud project** (the app has no server and no account of its own,
ADR-0001). It asks for a single scope, `drive.file`, so it only sees files it created and cannot touch other files in
your Drive.

This guide assumes the **custom build you use yourself**, with the Google Cloud client baked in. You set up Google
Cloud once, put that client ID and client secret into the app build, and every device then only needs **Sign in with
Google**. A build without baked-in values (public source or CI builds) can still enter them in the app as before.

## 1. Google Cloud setup (once)
1. Create a new project at <https://console.cloud.google.com/>.
2. Under **APIs & Services → Library**, enable *Google Drive API*.
3. Open **Google Auth Platform** in the left menu (formerly the OAuth consent screen). If this is your first time,
   press **Get Started**.
   - **Branding** (formerly the app information on the OAuth consent screen): enter the app name, user support email,
     and developer contact, agree to the Google API Services User Data Policy, then create it.
   - **Audience** (formerly the user type and publishing status on the OAuth consent screen): keep the user type as
     **External**. While the app is in testing, refresh tokens expire after 7 days, so press **Publish app** to move it
     to **In production**. While it stays in testing, add your own account as a test user.
   - **Data Access** (formerly the scopes on the OAuth consent screen): under **Add or Remove Scopes**, add
     `https://www.googleapis.com/auth/drive.file` and save. `drive.file` is not a sensitive scope, so no app
     verification is needed.
4. **Clients** (formerly the OAuth client ID in credentials): **Create Client** → application type **Desktop app**.
5. Copy the **Client ID** and **Client secret**. The secret is shown in full only once right after creation and only its
   last four characters are shown afterwards, so store it somewhere safe immediately.

> These menu names were checked against Google's own documentation: [configuring the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent), [Audience settings](https://support.google.com/cloud/answer/15549945), and [managing clients](https://support.google.com/cloud/answer/15549257). If the console shows **Google Auth Platform not configured yet** on first visit, follow the **Get Started** flow in [Get started with Google Auth platform](https://support.google.com/cloud/answer/15544987).

> A desktop app client secret is not a true secret in an installed app, but it still must not be committed to the repository or published in a build artifact.

## 2. Connect in the app

### Put the keys in your custom build
1. Copy `apps/desktop/.env.gdrive.local.example` to `apps/desktop/.env.gdrive.local`.
2. Fill in both values.

```sh
NOPS_GDRIVE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
NOPS_GDRIVE_CLIENT_SECRET=xxxx
```

`apps/desktop/.env.gdrive.local` is excluded from git by `.gitignore`. You can pass the values as environment
variables instead.

```sh
cd apps/desktop
NOPS_GDRIVE_CLIENT_ID='…' NOPS_GDRIVE_CLIENT_SECRET='…' pnpm package
```

- The values go into the **main bundle only**, never into the renderer or preload.
- Without the values the app behaves as a manual-entry build (public source, CI).
- Build artifacts (`dmg`, `zip`, an installer exe) contain the keys, so **never share them publicly or upload them to GitHub.**

### First run
1. Open a vault in the app.
2. Open **Settings (⌘,) → Vault → ☁ Google Drive sync…**.
3. With a built-in client, just press **Sign in with Google**. The browser asks you to sign in and allow access, then
   returns to the app.
4. Right after signing in, the first sync preview opens. Turn on **Sync this vault with Drive**, review the plan, then
   run it.
5. After that the app syncs automatically 10 seconds after a file changes, and every 2 minutes.

The confirmation step before the first sync is a safety measure and stays in place. Signing in alone never uploads or
deletes anything.

## 3. A second device
Install the app build that contains the same client, and open an **empty folder with the same name** as the vault.
Drive folders are matched by vault name: `Nopsidian/<vault name>/`.
If the first sync preview lists files to **Download**, the connection is correct.

## Advanced: use a different client
- A client **you entered takes precedence** over the built-in one.
- Switching back to the built-in client clears the values you entered and does not reuse the other client's refresh
  token. You have to sign in again.
- Changing the client cleans up the existing tokens automatically. A refresh token from another client cannot be used.
- Manually entered values are encrypted with the OS keychain (`safeStorage`) and stored on this device only.

## Troubleshooting
**Diagnostics** in the sync dialog shows token expiry, the last sync, why it failed, and the Drive folder state in one
place. **Check now** reads only the token and the `Nopsidian/<vault name>/` folder; it never syncs, uploads, or deletes.

| Error shown in the app | What to check |
|---|---|
| Google sign-in expired (`HTTP 401`) | **Check now** first tries to renew with the refresh token. Check again in a moment, and if sync keeps returning 401, reconnect your Google account. |
| The Google Drive API is off (`accessNotConfigured`) | In the Google Cloud console, under APIs & Services → Library, enable **Google Drive API**. |
| Google Drive storage is full (`storageQuotaExceeded`) | Free up Drive storage or use another account. |
| Google is rate limiting requests (`rateLimitExceeded`, `dailyLimitExceeded`) | Press **Check now** again in a minute or two. |
| No internet connection (`NETWORK`) | Check the network and try again. |
| No permission to access Drive (`HTTP 403`) | Check the Google account permissions and the client settings. |
| Google had a temporary error (`HTTP 5xx`) | Try again in a moment. |
| Drive file or folder not found (`HTTP 404`) | Check again or run the sync again. |
| Could not find this vault’s folder in Drive (`FOLDER_MISSING`) | On a second device, check that you opened a vault with the same name. Having no folder before the first sync is normal. |

**Copy diagnostics** copies only the client source (built in or custom), the last four characters of the client ID,
whether a client secret is set, whether an account is connected, whether the folder exists, and error codes.
It never copies tokens, secrets, email addresses (masked or not), folder IDs or paths, or note names and paths.

## What sync does
- If only one side changed, that side wins. If both sides edited different blocks, they are merged automatically; if
  both edited the same block, both versions are kept and the note is marked as a conflict.
- Deletions go to the other side's trash (local `.nopsidian/trash/`, or the Drive trash). If a sync would delete more
  than 20% of the files at once, it stops and asks.
- Renames and moves are not uploaded again; Drive applies them as a move.
- Excluded from sync: indexes, history, trash, and sync state under `.nopsidian/` (except `config.json`, `graph.json`,
  and `comments/`), plus `.git/` and temporary files.
- Editing a file in the Drive web UI is picked up (the content hash is recomputed).
