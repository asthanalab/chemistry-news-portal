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
- [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md): verified setup blocker and proposed UND/NDUS IT handoff; no email has been sent.
- [google-backend/SETUP.md](google-backend/SETUP.md): historical Google integration only; it is not the selected hosting or backup plan.

## Working and deployed

- The header says **UND Department of Chemistry**.
- Plain white interface with Arial, ordinary navigation, and a centered Submit news link. No submission list, search, filters, or empty-inbox message on the home page.
- Students, faculty, and staff can contribute using a name and research group, without an account or institution-name field.
- Category-specific forms, multiple publications in one submission, optional images, release preferences, and a submission receipt.
- Each publication has Comments to the office and More information fields. Office comments stay out of editorial-copy exports.
- Submitted records and images are private to the password-protected office. Contributors can reopen only their own unfinished drafts from the same browser.
- The office reviews, searches, edits, archives, and exports records within the portal. Excel, media ZIPs, and complete JSON backups are available as downloads.
- Password verification, failed-login throttling, 30-minute office sessions, server-side access checks, version conflicts, and bounded uploads are implemented.
- Cloudflare Workers Free hosts the live portal. Local preview data is separate and has not been automatically uploaded to production.

## Selected next work — not yet active

The latest account choice is **UND Microsoft 365**, replacing the earlier Gmail/Google Drive proposal.

| Requirement | Intended behavior | Current status |
| --- | --- | --- |
| Main administrator | `ayush.asthana@und.edu` receives administrative messages and password-reset links | Requested; not configured in the hosted application |
| Sending account | Use the UND Microsoft mailbox for the authorized administrative emails | Not connected |
| Private backup destination | A separate UND OneDrive folder named **UND Chemistry News Backups** | Not created or connected |
| Local visibility | The backup folder appears within university OneDrive in Finder; keep downloaded if an offline copy is wanted | Active sync location still needs verification |
| Change administrator later | Office settings provide a verified administrator-email change flow | Not implemented |
| Password reset | Expiring, one-use links sent only to the configured administrator; completing a change invalidates existing office sessions | Not implemented for Cloudflare; current dialog accurately reports unavailable email |
| Storage rollover | Start a verified backup when content reaches the configured storage ceiling minus 50 MB; notify administrator, then reclaim only safely backed-up live data | Not implemented; automatic cleanup is off |

Microsoft sign-in completed on October 27. Opening **App registrations → New registration** then returned **You do not have access** with error code 401. UND/NDUS IT needs to confirm access or arrange the registration; this account cannot currently complete that step. Do not treat a successful browser sign-in as authorization for the deployed portal. No Microsoft app permissions have been granted to the portal, and no automated email or backup has been activated. The [Microsoft setup handoff](MICROSOFT_SETUP.md) records the concrete blocker and proposed permissions.

## Storage rollover design requirements

The existing application ceiling is **256 MiB** (`268435456` bytes), with a separate **1,000-record** cap and **16 MiB** record-metadata cap. The interface uses the label MB for binary units. If the requested safety margin uses the same convention, the proposed content trigger is **206 MiB** (`216006656` bytes). This is an application limit, not a claim about the provider's maximum allocation. Record count and metadata limits must also be considered.

Before enabling the rule:

1. Connect the approved UND mailbox and a private OneDrive folder using only the permissions required for this portal.
2. Back up all required record content, images, private office notes, original copy, and history, with a manifest and integrity checks. Process large data in bounded pieces rather than loading the entire store at once.
3. Verify the saved backup can be read and restored. Email a private backup link and summary instead of relying on oversized attachments.
4. Reclaim only the exact versions and image bytes verified in the backup. Preserve new or edited records, active unfinished drafts, and material whose recoverability is uncertain. Define and document the cleanup scope before activating it.
5. If backup, verification, or notification fails, retain live data and show an actionable office status. Email acceptance alone is not proof of delivery or proof of a valid backup.
6. Test retries, interrupted jobs, duplicate notifications, changed records, expired Microsoft authorization, full OneDrive, and restore before enabling deletion.

The built-in manual backup remains available while this work is pending. The current live portal does not automatically email, move, or delete submissions when storage fills; writes stop at capacity.

## User decisions to preserve

- Use free services only. No billing details, paid upgrades, paid APIs, automatic purchases, or paid fallback.
- Do not promise free hosting forever. There is no configured project expiry, but third-party policies, account access, and service availability may change.
- Keep submissions and attachments private; a public source repository is not a public news feed.
- Keep the simple design and account-free contributor workflow.
- The office inbox is the main output; Excel is optional.
- The requested automatic emails are limited to administrator storage/backup notifications and password reset. Do not send unrelated submission, review, or other emails without explicit permission.
- Prefer UND mail and UND OneDrive for the pending integration. Do not silently substitute Gmail or Google Drive.
- Keep project decisions, setup notes, validation, and remaining work in this folder and GitHub. Never publish passwords, password verifiers, OAuth tokens, session cookies, private submissions, backups, or sign-in screenshots.

## Deployment and verification record

- 2026-10-23: live Cloudflare deployment and GitHub Pages redirect verified. The automated suite passed **38 tests**, including five tests in the local Cloudflare runtime. Live synthetic submission, image, office-only access, Excel export, and office locking were checked. The fictional deployment-check record was archived, not deleted. No real departmental submission was uploaded during deployment.
- 2026-10-27: department label updated in GitHub commit `7b2bf9f87611e1b342cf851f7baac06a18dccc92` and deployed as Cloudflare version `da9fd252-77cd-4b08-8eb0-fffe18504c05`. Asset build, syntax, published file hash, and live header checked.
- 2026-10-27: project notes consolidated; UND Microsoft/OneDrive preference and outstanding integration work recorded. University sign-in succeeded, but the app-registration page denied access (401). Documentation changes do not activate backup, email, or cleanup features.

For deployment, retain Worker name `chemistry-news-portal`, Durable Object class `Newsroom`, and object name `department-news` to preserve the existing store. Runtime credentials belong in private Worker secrets or ignored local files. Public source updates and Cloudflare deployments are separate actions; a GitHub documentation commit does not deploy application code.

## Microsoft implementation references

These references support the proposed design; they are not evidence of an active connection:

- [OneDrive application folders](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder): an application folder can restrict file access and appears under `Apps/{application name}`. Confirm its actual path and sync behavior during setup.
- [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0): delegated mail sending; an accepted request is not delivery confirmation.
- [Register a Microsoft application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app): application registration and redirect setup, subject to university permissions.

A chat connector or an existing browser sign-in cannot supply reusable authorization to a hosted Worker. Use a supported Microsoft authorization flow and keep runtime credentials private.
