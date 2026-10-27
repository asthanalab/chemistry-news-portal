# UND Chemistry News Portal — project notes

Updated: 2026-10-27. This is the main handoff and decision record. Keep it in the project folder and in the public GitHub repository. A planned feature is not active unless the status below says it is deployed.

## Where things live

| Item | Location |
| --- | --- |
| Public source and project notes | [asthanalab/chemistry-news-portal](https://github.com/asthanalab/chemistry-news-portal) |
| Public entry link | [GitHub Pages](https://asthanalab.github.io/chemistry-news-portal/) |
| Working portal and private API | [Cloudflare portal](https://chemistry-news-portal.chemistry-newsroom.workers.dev/) |
| Local project | The `chem_news` project folder containing this file |
| Local Node preview | `http://127.0.0.1:4173` when started |
| Local Cloudflare preview | `http://127.0.0.1:4174` when started |
| Live records and images | Private Cloudflare SQLite Durable Object; never in GitHub |
| Local records, credentials, and sensitive operational notes | Ignored `.local/` folder; never publish |

The repository belongs to **asthanalab**. A separately connected GitHub account does not change that ownership. GitHub Pages redirects to Cloudflare; GitHub does not store incoming submissions or run the office login.

## Notes index

- [README.md](README.md): running, using, and deploying the existing portal.
- [PLATFORM_PLAN.md](PLATFORM_PLAN.md): form fields, outputs, architecture, and pending work.
- [VALIDATION.md](VALIDATION.md): historical test and deployment evidence, with current status at the top.
- [AGENTS.md](AGENTS.md): instructions to keep these notes current and preserve the project's constraints.
- [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md): historical, superseded Microsoft setup blocker; no email was sent.
- [google-automation/SETUP.md](google-automation/SETUP.md): current Drive-only backup setup and recovery instructions. The older google-backend directory is inactive historical code.

## Working and deployed

- The header says **UND Department of Chemistry**.
- The live footer reads **Private departmental submissions. AI generated tool.** as requested. This is presentation wording; no AI service or email transport was added.
- Plain white interface with Arial, ordinary navigation, and a centered Submit news link. No submission list, search, filters, or empty-inbox message on the home page.
- Students, faculty, and staff can contribute using a name and research group, without an account or institution-name field.
- Category-specific forms, multiple publications in one submission, optional images, release preferences, and a submission receipt.
- Each publication has Comments to the office and More information fields. Office comments stay out of editorial-copy exports.
- Submitted records and images are private to the password-protected office. Contributors can reopen only their own unfinished drafts from the same browser.
- The office reviews, searches, edits, deletes individual news items with confirmation, archives, and exports records within the portal. Excel, media ZIPs, and complete JSON backups are available as downloads.
- Password verification, failed-login throttling, 30-minute office sessions, server-side access checks, version conflicts, and bounded uploads are implemented.
- Cloudflare Workers Free hosts the live portal. Local preview data is separate and has not been automatically uploaded to production.

## Current backup choice and setup status

The backup choice is **private Google Drive backups with no Gmail access and no email-sending permission in that project**, replacing Microsoft. The final October 27 recovery choice is Google identity verification for the approved administrator account, replacing the proposed mail sender. No emails are authorized. The user approved the reduced Drive-only permissions on October 27. Gmail ownership means the Google account owns the Drive folder; backups are not emails.

| Item | Current setting |
| --- | --- |
| Drive account | Existing Google account `ayushasthana15@gmail.com` |
| Backup destination | Private **UND Chemistry News Backups** folder at My Drive root |
| Email | No reading or sending. Google sign-in recovery is identity-only; the UND address remains the administrator contact |
| Office password | Existing credential preserved; current-password change form implemented. Hosting-secret rotation remains a recovery path |
| Schedule | Daily, approximately 9–10 a.m. America/Chicago, executed by Google servers |
| Trigger | Portal content at or above 209 MB (209 MiB in the existing interface convention) |
| Retention | Keep roughly the newest 50 MB of whole submitted news items, plus protected drafts and newer edits |
| Connection status | Connected and enabled after a verified live backup and isolated restore on October 27 |

The portal-side implementation is deployed and the daily retention rule is enabled. The initial backup saved all four current records and two images; independent downloads matched the manifest, restored through the real local import path, preserved notes/history/image bytes, and skipped duplicate IDs on a second import. Office settings then enabled automatic cleanup. Current storage is about 538 KB, so no live news was removed. No email was sent.

## Backup and cleanup safeguards

1. The Google script requests only per-file Drive access, external requests and its own trigger management. It uses neither GmailApp nor MailApp and has no public Google web-app endpoint.
2. A 20-minute one-use office connection code establishes a private signing key. The key stays in Google Script Properties and private portal storage. Signed requests expire and cannot be replayed.
3. Daily checks are silent. At 209 MB, snapshot every record and referenced image, including drafts, private office notes, original copy and history. Saved per-record JSON files are directly restorable through the existing import; a manifest records file IDs and checksums.
4. Read each file back and compare SHA-256 checksums. Recheck file identities, parents, checksums and private folder access before acknowledging completion.
5. Remove only unchanged non-draft snapshot records older than the newest retained 50 MB. Preserve drafts, changed/new records and newly pending images. Protected data can leave the portal above the retention target. Never use a lower file size as a reason to delete unverified data.
6. If backup, verification, permission or quota fails, retain live records and report the issue in Office settings. Retry requires resolving the cause. Deleting or sharing the root folder stops cleanup; daily checks do not silently recreate it.
7. Drive backups accumulate until the owner removes them. No automatic purchase or paid fallback is configured. Independent portal limits of 256 MB content, 1,000 records and 16 MB metadata still apply and stop writes when reached.

A first verification backup sends no email and deletes nothing. Large active jobs can use one-off continuation triggers to finish within Google’s runtime limits; the recurring storage check is still daily.

## New upload and office controls

- Every news image input enforces a 10 MB final per-file cap, including every publication in a multi-publication submission. The overall 30 MB submission image cap remains.
- Supported JPG/PNG/WebP images above 10 MB and up to 50 MB are compressed on the contributor’s device. Lossless PNG is tried for figures; high-quality WebP and resizing are fallback options. The UI asks users to inspect readability. Files that cannot be reduced are rejected. Smaller originals remain unchanged.
- Each office review has **Delete news item** with a confirmation naming that item. Deletion is permanent in the portal, checks its current version, and removes live attachments; existing backups are retained. Contributor access cannot call this operation.

## User decisions to preserve

- Use free services only. No billing details, paid upgrades, paid APIs, automatic purchases, or paid fallback.
- Do not promise free hosting forever. There is no configured project expiry, but third-party policies, account access, and service availability may change.
- Keep submissions and attachments private; a public source repository is not a public news feed.
- Keep the simple design and account-free contributor workflow.
- The office inbox is the main output; Excel is optional.
- Latest instruction: no Gmail read or send permission. Use identity-only Google sign-in restricted to `ayushasthana15@gmail.com` for forgotten-password recovery. All portal emails remain disabled.
- Use private Google Drive backups under the existing Google account. Keep the root folder visible at the top of My Drive. Microsoft/OneDrive and email plans are superseded.
- Keep project decisions, setup notes, validation, and remaining work in this folder and GitHub. Never publish passwords, password verifiers, OAuth tokens, session cookies, private submissions, backups, or sign-in screenshots.

## Deployment and verification record

- 2026-10-23: live Cloudflare deployment and GitHub Pages redirect verified. The automated suite passed **38 tests**, including five tests in the local Cloudflare runtime. Live synthetic submission, image, office-only access, Excel export, and office locking were checked. The fictional deployment-check record was archived, not deleted. No real departmental submission was uploaded during deployment.
- 2026-10-27: department label updated in GitHub commit `7b2bf9f87611e1b342cf851f7baac06a18dccc92` and deployed as Cloudflare version `da9fd252-77cd-4b08-8eb0-fffe18504c05`. Asset build, syntax, published file hash, and live header checked.
- 2026-10-27: project notes consolidated; UND Microsoft/OneDrive preference and outstanding integration work recorded. University sign-in succeeded, but the app-registration page denied access (401). Documentation changes do not activate backup, email, or cleanup features.
- 2026-10-27: footer changed to “Private departmental submissions. AI generate tool.” Syntax and asset build passed; GitHub source matched the local file, and the exact text was verified on the live portal. Cloudflare version: `c7e75de4-c093-485a-ac77-28409ef78daa`. Only `app.js` changed among deployed static assets.

For deployment, retain Worker name `chemistry-news-portal`, Durable Object class `Newsroom`, and object name `department-news` to preserve the existing store. Runtime credentials belong in private Worker secrets or ignored local files. Public source updates and Cloudflare deployments are separate actions; a GitHub documentation commit does not deploy application code.

## Current implementation references

- [Google per-file Drive access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Advanced Drive service](https://developers.google.com/apps-script/advanced/drive)

A connector or browser sign-in does not supply a hosted runtime credential. The current script uses the account’s approved Drive-only authorization; no Google token is published or copied into portal source.

## October 27 upload, deletion and retention revision

The current local full suite passed **55 tests** after removal of email access. Coverage includes disabled email endpoints, exact limited Google scopes, 209 MiB trigger, 50 MiB latest-news retention, verification-before-cleanup, draft/edit preservation, signed-request replay rejection, missing/corrupt backup handling, per-item delete permissions/version checks and 10 MiB server upload enforcement. Tests use isolated synthetic data and mocked Google services, not live emails or live deletions.

A browser test compressed a 15,877,193-byte synthetic PNG to a displayed 4.4 MB WebP, submitted it to isolated local Cloudflare storage and opened its office review. The per-item delete confirmation named the correct item; it was cancelled. No live data was imported from that preview. That revision was deployed as Cloudflare version `4573f7c7-4e78-4674-b35b-1a2f87dac970`.

The Drive folder’s parent was confirmed to be the account’s My Drive root. The root folder, dated backup folder, four record files and manifest were all verified private, with only owner permissions. The initial backup completed on October 27 at 5:14 p.m. Central. The independent restore receipt is kept privately in ignored `.local/drive-restore-check/receipt.json`; private backups and screenshots are not published.

## October 27 footer wording correction

Corrected the footer to **Private departmental submissions. AI generated tool.** JavaScript syntax and the production asset build passed, and the exact wording was verified in the live browser. Production deployment at that text-only checkpoint: `39dec5ce-5d7c-4497-93ff-0fcbc6c5c4f3`. Only the static app.js asset changed. The prior 55-test result remains historical; the full suite was not rerun for this text-only edit.

## October 27 security review and Google recovery revision

The final user choice is current-password change plus Google-based forgotten-password recovery restricted to **ayushasthana15@gmail.com**. The UND address **ayush.asthana@und.edu** remains the department administrator contact. No Gmail read/send permission or email transport is used. The unactivated email-sender proposal was retained only in ignored local scratch and removed from the application.

The final revised full suite passed **67 tests**, including 12 tests in the actual local Cloudflare runtime and signed Google token verification using JOSE. Seventeen bounded access checks passed against the final live deployment. A real sign-in with the approved Google account reached the new-password form; the fields were left blank and the existing password was not changed. Password replacement, old-session revocation and single-use enforcement were tested with isolated synthetic credentials. No tested route granted unauthorized office data access. This is a bounded application review, not a guarantee against every attack. The existing password is unchanged and should be replaced privately with a strong unique passphrase.

The new code revokes all office sessions when a password changes, rejects concurrent token reuse, rechecks office access after asynchronous operations, and lets a hosting-secret rotation override an in-app credential. Recovery verifies Google's signature, issuer, client audience, expiry, nonce, verified email and exact approved account. The flow uses browser-bound state and PKCE and consumes its callback once. It requests only `openid email`, no offline access, and retains no Google access/refresh token. Successful Google verification grants a 20-minute single-use password-reset capability, not an office session. The private Google subject identifier is pinned on first successful recovery. Another account cannot recover the office even if it can sign in to Google.

A dedicated **UND Chemistry Portal Recovery** Google project is configured under the existing Google account, with no billing or paid service enabled. The user approved the policy, client connection and production update. It remains in external testing mode with only the approved account as a test user. The Google consent screen requested only the account email address. Its client credential is stored in a private Worker secret, never public source. See [setup instructions](GOOGLE_RECOVERY_SETUP.md).

The final production deployment is `86224b8b-c4d5-4b7b-996a-080d40e176fd`. A live compatibility issue in the Google code exchange was fixed and covered by an actual Workers outbound-request regression test; redirects from the token endpoint are rejected. The private diagnostic reports successful verification. All four existing records remain present, and the separate Drive backup connection and daily rule remain enabled. No live records, password or email settings were changed.

Publish this revision’s public source and notes together and verify their GitHub blob hashes. Credentials, private receipts, reset capabilities and account screenshots remain under ignored `.local/`; they are not part of the public update.
