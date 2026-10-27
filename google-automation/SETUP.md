# Private Google Drive backup setup

This is the current integration. It does not use Gmail, send email, expose a public Google web app, or require contributor sign-in. Keep billing disabled.

## Files and permissions

Create an Apps Script project under the intended Google account. Copy `Code.gs` and the complete `appsscript.json`. Enable the visible manifest in project settings; the manifest enables Advanced Drive v3. The only requested scopes are:

- `drive.file`: access files this script creates or files explicitly opened with it; no whole-Drive access.
- `script.external_request`: contact this portal and read its own saved backup files for verification.
- `script.scriptapp`: manage this script’s daily and continuation triggers.

Never add Gmail, send-mail, user-email or whole-Drive scopes. The source uses neither GmailApp nor MailApp. Google permissions are subject to the account’s consent; do not mistake browser sign-in for a working connection.

## Connect and verify

1. In the authenticated portal’s Office settings, choose **Get Google connection code**. Keep this 20-minute, one-use value private.
2. Put it in `PAIRING_CODE` only in your private Apps Script project. The public repository must keep that value empty.
3. Run `setup` after approving the limited Drive permissions. It creates **UND Chemistry News Backups** at My Drive root, verifies private ownership and establishes signed communication. A private shared key stays in Script Properties and the portal database.
4. Run `finishSetup`. It creates one daily check around 9–10 a.m. America/Chicago. No public web-app deployment is needed. Automatic deletion remains disabled.
5. In Office settings choose **Create verification backup**, then run `runBackup` from the Google project. The initial backup removes nothing and sends no email. Inspect the folder, manifest and saved bytes, and validate restoration using isolated local data.
6. Once the initial backup is verified, choose **Enable automatic cleanup** in Office settings. This control is unavailable before a nonempty verified backup finishes.
7. Remove the expired pairing value from the private editor for tidiness. Never publish Script Properties, tokens, private backups or source containing a pairing code.

## Daily rule

Check once daily. Below 209 MB, take no backup or cleanup action. At or above 209 MB, snapshot all records and image bytes, save dated per-record `.newsroom.json` files plus a manifest, and verify saved checksums. Delete only older unchanged submitted records while retaining roughly the newest 50 MB of whole news items. Drafts, newer edits, new submissions and pending uploads remain even if the resulting total exceeds 50 MB. The app displays binary MiB as MB.

No emails are sent for backups, checks, failures, submissions, review actions or password recovery. Failures appear in Office settings. A missing/shared/full folder stops cleanup. The script does not silently replace a deleted root folder or purchase storage. Drive backups accumulate until the owner removes them. The independent record-count/metadata limits can stop portal writes before the byte threshold.

Large backups resume with one-off continuations that finish the current job; these are not extra recurring checks. Each run is bounded to four minutes of work. Google hosts the schedule, so the owner’s computer and this chat need not stay open. Free provider quotas and future policy changes still apply.

## Restore and operational checks

Each per-record JSON file uses the portal’s complete backup format and includes its images. Import it through Office settings; existing IDs are skipped rather than overwritten. Keep backups private because they contain office notes. The manifest records each file ID and checksum. A locally exported full backup remains available independently of Google.

If Google authorization is revoked, the script cannot complete a backup and portal records remain. Restore access, inspect the error, and use **Retry at next scheduled check** after resolving the cause. If the root folder was deleted, restore that same folder from Drive Trash first. No automatic replacement or paid quota upgrade occurs.

## References

- [Google per-file Drive permissions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Advanced Drive service](https://developers.google.com/apps-script/advanced/drive)
