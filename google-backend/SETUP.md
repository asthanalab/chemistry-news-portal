> Legacy adapter, retained for reference and regression tests. The selected hosted portal uses Cloudflare and does not connect to Google or send emails.

# Optional shared workspace with Google

This backend is prepared for the next stage. **Do not deploy it until the local preview has been reviewed.** No account setup or deployment has been performed. This path uses an existing Google account and has no billing requirement. Keep billing disabled; do not purchase a domain, add storage, or upgrade a plan to run the first version.

The backend sends no submission or review emails. At the user's explicit request, it can send office password-change links only to the configured administrator. It neither shares uploaded images publicly nor gives contributors access to the underlying Sheet or folder.

## What an administrator will need

- An existing Google account permitted to run Apps Script; a university administrator may restrict this.
- A blank Google Sheet and a dedicated private Google Drive folder, owned by that account.
- The Google account emails of the communications editors and approved contributors.
- A Google OAuth web client ID for the frontend's Google sign-in. Creating an OAuth client does not require paid compute or a billing account. Keep the consent configuration minimal: identity only.

Only the administrator grants the script access to Sheets, Drive, and the limited email-sending scope required for password changes. The supplied manifest declares those scopes explicitly. Contributors authenticate their identity and do not grant access to their own Drive files. Review the scopes during setup; do not grant permissions to unrelated accounts.

## Configure the backend

1. Create a standalone Apps Script project under the chosen Google account. Copy `Code.gs` and `appsscript.json` from this directory into the project.
2. In Script Properties, set the following values. Do not put them in public source as a substitute for backend configuration.

| Property | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth web client ID used by the frontend |
| `SHEET_ID` | ID of the dedicated private spreadsheet |
| `DRIVE_FOLDER_ID` | ID of the dedicated private upload folder |
| `EDITOR_EMAILS` | Comma-separated verified Google account addresses allowed to review all stories |
| `CONTRIBUTOR_EMAILS` | Comma-separated approved contributor addresses; start with explicit accounts for the pilot |
| `ALLOWED_DOMAINS` | Optional Google Workspace hosted domains; leave blank for an account-by-account pilot |
| `OFFICE_PASSWORD_SALT` | Private password salt from the local verifier configuration |
| `OFFICE_PASSWORD_VERIFIER` | Hash of the PBKDF2-derived password proof, never the actual password |
| `OFFICE_RESET_EMAIL` | The administrator address designated by the user; include this account in `EDITOR_EMAILS` |
| `PORTAL_URL` | Exact deployed HTTPS frontend URL including its repository path/trailing slash, with no fragment |

Domain-based access requires Google's verified `hd` claim. An email suffix alone does not grant domain membership. Every request is authenticated, and editor access comes only from `EDITOR_EMAILS`.

Office access also requires the office password. Verified office accounts initially receive the contributor role until they unlock the inbox. The backend verifies a 600,000-iteration PBKDF2-SHA256 proof against a stored hash, issues a random 30-minute session bound to the verified Google subject, and checks that session for every office request. Five failed guesses pause password login for five minutes. Changing the password invalidates all old office sessions. The browser never saves the password, password proof, or Google office token to persistent storage.

The current private values for the password and requested reset recipient are prepared in `.local/google-password-settings.json`, which is ignored by Git. Copy those settings manually into Script Properties and fill in the final `PORTAL_URL`. Do not publish that file or place its values in frontend configuration.

The **Change password → Send password-change email** action sends only to `OFFICE_RESET_EMAIL`, never to a browser-provided address. The link expires in 20 minutes, can be used once, and requires sign-in as that exact administrator account. Requests are limited to one email every ten minutes. The current password remains valid until completion. Token verification and email behavior have been tested with service stubs only; no real email has been sent. In local preview the email request button is disabled until this backend is connected.

Office accounts can read submitted news, attachments, and review history, and export records. Contributors can read and update only their own unfinished drafts. Once sent, a submission is office-only, even for its contributor. The save response contains only a receipt (`id`, `reference`, and `status`); guessed IDs, a spoofed browser role, and an Approved/Published status never grant public access. “Changes requested” is an internal office status; arrange any clarification separately. No notifications or public submission feed are provided.

3. Run `setupNewsroom` once as the owner. It creates a `Newsroom` tab in the selected spreadsheet and checks access to the selected folder. It does not alter unrelated files or send messages.
4. Deploy as a web app executing as the owner. The URL must accept requests before Google authentication so that the application can verify the supplied ID token itself. Deployment availability and “Anyone” access are subject to the account's organizational policy. If that option is unavailable, stop and use an approved institutional deployment route; do not weaken access restrictions elsewhere to work around it.
5. Record the `/exec` deployment URL. Keep the Sheet and upload folder private. Do not enable “Anyone with the link” for either.

## Configure sign-in and the frontend

1. Create a web client for Google Identity Services with the final frontend origin as an authorized JavaScript origin. For local integration testing, include `http://127.0.0.1:4173`. For GitHub Pages, use `https://<account>.github.io` (no repository path in the origin).
2. Configure the appropriate OAuth audience and approved test users. Do not choose paid identity features or paid cloud services.
3. In `public/config.js`, set `mode: 'google'`, `googleClientId`, and `googleScriptUrl`. These two frontend identifiers are public configuration, not secrets. Never add an OAuth client secret, private key, or user token to the repository.
4. Restart/reload the preview. Verify that the sign-in button loads and that an approved account can reach the shared workspace. ID tokens are held only in page memory.

The frontend uses a plain-text POST body to avoid an unnecessary CORS preflight, and follows the Apps Script ContentService redirect. **This cross-origin flow has not yet been tested against a real deployment.** Test it from the exact preview and GitHub origin before declaring the shared version ready. If an institutional policy or browser rejects the response, the integration needs an approved hosting adjustment; do not make the data public to bypass it.

Google documentation: [Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [server-side ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [ContentService](https://developers.google.com/apps-script/guides/content).

For this initial adapter, Google validates ID tokens through its token-info endpoint. Google describes that endpoint as a development/debugging aid. Before a wider production rollout, migrate verification to a supported JWT verification implementation that caches Google's public keys, or an institution-approved server using an official Google authentication library. The current hosted adapter is a pilot integration, not a completed production authentication deployment.

## Required live verification before department use

- An unapproved Google account is rejected.
- Contributor A cannot list, read images from, or change Contributor B's stories, even with a guessed ID.
- A contributor can reopen their own draft, but cannot list, read images from, or change it after submission. Its submission response contains only a reference receipt. Repeat these checks for Approved, Published, Archived, and Changes requested records.
- A contributor cannot approve/publish a story or assign their own editor role.
- An editor can review both contributors' stories and export their media.
- Upload, draft save, submit, reload, office editing, and media-package download work through the exact deployed URL.
- Direct links to the inbox, submitted records, archive, and settings require office sign-in. Signing out clears the open record, export selection, and cached workspace.
- An expired token is rejected; the contributor can sign in again without losing an already saved draft.
- A quota/storage failure is displayed without charging, upgrading, or reporting a failed save as successful.
- The configured Sheet and Drive folder remain private, and ordinary submissions/reviews produce no emails.
- An allowlisted office account still cannot read submitted records before entering the password. Incorrect passwords, forged sessions, expired sessions, and a session copied to a different Google account are rejected.
- With the user's approval for a live test, verify that a requested password-change email goes only to the configured administrator, that its link expires and is single-use, and that changing the password locks old sessions. Confirm that no email is reported as sent on quota or delivery failure.

## Maintenance and backups

Download regular complete backups from Workspace settings, and retain both the configured spreadsheet and image folder in the department's approved backup process. Spreadsheet data alone does not contain the image bytes. Test restoring an application backup into a separate local preview.

Removed attachments are retained in Drive for this first version. The app never automatically deletes files. Failed uploads may leave a reusable file under its deterministic record/image name. Review retention and any cleanup with the administrator before adding a deletion workflow.

Quota limits may change. The backend returns a free-limit error and does not attach billing or buy capacity. If available storage is exhausted, stop intake until capacity is available or reduce the retained data according to the department's policy. [Google's quota documentation](https://developers.google.com/apps-script/guides/services/quotas)

## GitHub publication after preview approval

Publish only the contents of `public/` using a public GitHub repository on GitHub Free, with GitHub Pages configured to serve those files. Keep private backups, submissions, Drive data, and test artifacts out of Git. No deployment workflow is enabled in this first version, so committing the project alone cannot unexpectedly publish it.

Enable Google mode and pass the live checks before calling the deployed page a shared inbox. Local mode intentionally refuses to initialize on a public hostname. Its password gate protects a local preview interface; shared submissions require the server-enforced Google identity and office-password checks.
