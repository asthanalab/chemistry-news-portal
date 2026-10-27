# Chemistry News Portal

[Open the live portal](https://chemistry-news-portal.chemistry-newsroom.workers.dev/) · [GitHub entry link](https://asthanalab.github.io/chemistry-news-portal/)

A private departmental news intake and review portal. Contributors need only their name and research group. **Contributors need no account. The hosted version uses Cloudflare Workers Free, without a paid API or subscription.** Office staff read submissions, view images, manage review status, and export Excel files inside the portal.

## Project notes

Start with [PROJECT_NOTES.md](PROJECT_NOTES.md) for current status, decisions, hosting locations, pending work, and the latest handoff. [PLATFORM_PLAN.md](PLATFORM_PLAN.md) describes the form and architecture; [VALIDATION.md](VALIDATION.md) preserves test and deployment evidence. [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md) records the university app-registration blocker and proposed setup. [AGENTS.md](AGENTS.md) records instructions for keeping these notes current locally and on GitHub.

The live header is **UND Department of Chemistry**. Private Google Drive backups are selected, with **no inbox access or email permission in the backup project**. The daily rule is enabled after a verified initial backup and isolated restore; see project notes for the live status. No paid service is authorized.

## Run the local preview

With Node.js 20 or later:

```sh
node server.mjs
```

Open [the portal](http://127.0.0.1:4173), or double-click `start-preview.command` on this Mac. The server listens only on `127.0.0.1`; this preview is not accessible from other computers. Stop the server with Ctrl+C. The Node-only preview needs no installed packages. Cloudflare deployment and its integration tests use development dependencies.

## Contributor workflow

1. Open the link and select **Submit news**. No account or institutional email is required.
2. Choose a category and enter a name and research group. Students, faculty, and staff can submit.
3. Add the story, optional images, and release preferences; review and submit.
4. Keep the reference receipt. Submitted records are visible only to the office.

The home page keeps its header, navigation, and footer, with a centered Submit news link. The search, filters, and submission list belong to the office dashboard.

Drafts are saved on the portal server. A signed, HttpOnly cookie identifies this browser for up to 30 days. **My drafts** contains only drafts created by that browser. Another browser or device cannot recover them without office help. Clearing cookies removes access to drafts, but does not delete records from the server. Names and group affiliations are self-reported, not independently verified.

## Office workflow

Open **Office access** and enter the office password. The inbox supports searching, category/status filters, image viewing, private notes, status updates, archiving, and Excel/media downloads. **Refresh** retrieves new submissions without leaving the dashboard; navigating to the inbox also reloads it.

The password is checked by the server using a unique salt and 600,000 PBKDF2-SHA256 iterations. Only a hash of the derived proof is stored. Office cookies are HttpOnly and SameSite=Strict. Sessions expire after 30 minutes; **Lock office** revokes access. Login attempts are rate limited (five per network address in a five-minute window on Cloudflare). Server endpoints enforce permissions independently of the interface: contributors cannot read submitted records or attachments, even by guessing an identifier or changing their browser's role.

This checkout retains the previously configured office password. On a fresh local installation, the first office visit offers one-time password setup. `node configure-office-password.mjs` is an alternative that creates a password and displays it once; it does not replace an existing credential.

**Password changes and recovery.** Office settings provide a form requiring the current password and a live office session. The form asks for a new passphrase of at least 12 characters. All office sessions and pending recovery credentials are revoked on change. The browser derives the password proof; the server stores only its salted verifier. Forgotten-password recovery uses **Google sign-in restricted to the approved administrator account**, with only identity and email-address scopes. It requests no Gmail reading/sending, Drive or offline access, and sends no email. See [Google recovery setup](GOOGLE_RECOVERY_SETUP.md) and current activation status in project notes.

Each office review has a **Delete news item** control. It names the item and asks for confirmation before permanently deleting that news item and its live attachments. Existing downloaded/Drive backups are retained. Stale versions cannot delete a newer edit.

## Included

- Publications, grants, student milestones, awards, presentations, outreach, media coverage, announcements, and other news.
- Up to ten publications per submission, each with its own title, authors, venue, status, DOI/URL, abstract, optional date, comments to the office, and additional information.
- Up to three JPEG, PNG, or WebP images per publication or other news item; 10 MB per image and 30 MB per submission. Larger supported images up to 50 MB are compressed on the contributor’s device; the final file must be at most 10 MB. Captions, credits, alternative text, and permission status accompany images.
- Private editorial notes, activity history, original copy, embargoes, and image-permission holds.
- Genuine `.xlsx` workbooks, with one row per paper on the publication sheet and image metadata linked to the correct paper.
- ZIP media packages containing images, workbook, and a readable story digest.
- Internal exports and approved editorial-copy exports. The latter exclude office comments/private notes and apply release restrictions. Exports do not publish anything.
- Complete JSON backups and validated, atomic imports. Duplicate IDs are skipped, never overwritten.
- Plain white/Arial styling, responsive pages, keyboard-accessible controls, and labeled validation errors.

## Private storage and migration

`public/config.js` defaults to `mode: 'server'`. The built-in Node server stores records and images in `.local/submissions.json`, outside the served directory and ignored by Git. A separate private signing key identifies contributor browsers. Files use owner-only permissions. Saves are serialized, committed through an atomic rename, and checked for conflicting versions so one office edit cannot silently overwrite another.

This small-department preview uses a single-process JSON store, capped at 1,000 records or 256 MB. Capacity errors leave the previous data intact and never purchase storage or upgrade a service. It is not intended for multiple server processes. Back up regularly through Office settings. Data is private through server access controls and filesystem permissions; it is not application-encrypted at rest.

The update recovers an existing tab's own saved drafts into server storage. On the first office unlock, it imports earlier browser-only preview records, keeping their references, dates, images, and review history. Original browser copies remain intact. Existing IDs are skipped. Older drafts with no matching active contributor remain available to the office. **Import earlier browser preview records** in Office settings can retry recovery. Fictional records remain labeled and can be hidden.

The earlier IndexedDB and Google submission adapters are retained as inactive legacy code for reference. They are not used in server mode. Ordinary submissions do not load Google scripts or send news to Google. Administrator recovery redirects to Google for identity verification; the separately connected Drive script handles private backups.

## Hosting and cost

Source code is public at [asthanalab/chemistry-news-portal](https://github.com/asthanalab/chemistry-news-portal). Private records, images, passwords, local previews, and backups must never be committed.

The hosted deployment uses a Cloudflare Worker for the interface and API on the same HTTPS origin, with a private SQLite Durable Object for records and image chunks. Contributor and office cookies are Secure, HttpOnly, and SameSite=Strict in production. Image requests enforce the same access rules as the inbox. Public first-time password setup is disabled; the administrator configures a password verifier as a Worker secret.

Use **Workers Free** only. Do not add billing, upgrade to a paid plan, or enable paid resources. Free service quotas stop requests when exhausted; this app never purchases capacity. The app additionally caps stored content at 256 MB, record metadata at 16 MB, and records at 1,000. Images are limited to 10 MB each and 30 MB per submission. Orphaned uploads from interrupted forms can consume storage, so the office should monitor capacity. No analytics, paid image service, or R2 bucket is configured. No email permission is used. Google sign-in verifies only the recovery administrator; news and backups are never emailed. The optional private Drive backup script runs daily on Google’s servers, using only its own Drive files, external requests and trigger permissions.

Cloudflare may change its plans in the future; this package cannot guarantee perpetual third-party hosting. Review [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects Free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/) before enabling an account. GitHub Pages provides the public entry link and redirects to the working HTTPS portal. The form and private API share the Cloudflare origin so cookies and images remain protected.

### Deploy in an existing Free account

With Node.js 22 or later and pnpm 11:

    pnpm install --frozen-lockfile
    pnpm test
    pnpm build
    pnpm exec wrangler login --scopes account:read user:read workers_scripts:write
    pnpm exec wrangler deploy

Before sharing the link, configure the existing local office credential as the secret named OFFICE_CREDENTIAL using Wrangler's secret input. Its value is the JSON object in .local/office-password.json; never paste it into public source, an issue, a command-line argument, or a commit. The portal rejects API requests until that secret exists. Keep the same Worker name, Durable Object class, and object name for future updates to retain storage.

For a Cloudflare-runtime preview, put that credential in an ignored .dev.vars file, run pnpm build, then pnpm preview:cloudflare. This uses separate local test storage and does not upload earlier records. Backups can be imported explicitly by the office once the hosted portal is configured; existing IDs are skipped. Image files transfer first, then metadata imports commit atomically. A failed metadata import can leave private, unreferenced image uploads.

A hosting administrator can recover access by replacing OFFICE_CREDENTIAL with a newly salted credential. This overrides an in-app password change and invalidates its sessions and pending links. Never upload credentials to GitHub. Google recovery requires its own identity client. Drive backup authorization does not enable recovery.

## Files and checks

| File | Purpose |
| --- | --- |
| `public/` | Browser interface, form model, and export generation |
| `server.mjs` | Static files and private API routing, bound to loopback |
| `portal-store.mjs` | Persistent records, image validation, contributor sessions, permissions, imports |
| `office-auth.mjs` | Password verification, rate limiting, and office sessions |
| `.local/` | Private runtime data; never publish or commit |
| `tests/` | Access controls, persistence, validation, concurrency, exports, and legacy regression checks |
| `google-backend/` | Historical inactive integration; do not deploy its email features |
| `google-automation/` | Current Drive-only backup script and setup guide |
| `cloudflare/security.mjs` | Current-password changes and single-use password recovery |
| `cloudflare/google-recovery.mjs` | Administrator-only Google identity verification |
| `cloudflare/automation.mjs` | Signed backup exchange, verification and latest-news retention |

Install development dependencies, then run pnpm test. Cloudflare tests use the actual local Workers runtime. Some integration tests open temporary loopback ports. Test records are synthetic and isolated from the preview's data. Tests do not send emails.

The hosted API lives in cloudflare/worker.mjs, its bindings in wrangler.jsonc, and shared validation in record-validation.mjs. build-cloudflare.mjs prepares only public assets.

## Private Drive backups

See [google-automation/SETUP.md](google-automation/SETUP.md). The private folder **UND Chemistry News Backups** belongs at the top level of My Drive. The current policy is a silent daily check around 9–10 a.m. Central. At **209 MB**, create and verify a full backup, then remove older unchanged submissions while retaining roughly the latest **50 MB** of whole news items. Drafts, new edits and pending uploads are additionally protected. No data is emailed.

The interface labels binary MiB as MB, consistent with its existing upload/storage limits. The retention target can be exceeded by protected drafts or newer edits. The independent 1,000-record and 16 MB metadata caps still stop writes if reached first. A failed or missing backup destination stops cleanup. Backups accumulate in Drive; the script never purchases storage or deletes Drive backups. Deleting the root folder does not cause silent recreation during daily checks.
