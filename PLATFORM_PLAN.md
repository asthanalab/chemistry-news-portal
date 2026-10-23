# Chemistry News Portal — current implementation plan

Updated October 23, 2026. This replaces the earlier Google/Supabase proposals.

## Purpose and access

One link opens a simple departmental submission portal. Students, faculty, and staff provide their name and research group; no account or institutional email is needed. The home page retains ordinary navigation and a centered Submit news link. Submitted information is private to the office. Office staff enter a password to review submissions and images directly in the portal. Excel is an optional output, not the primary inbox.

## Inputs

The four steps are news type/contact details; story details; images/release preferences; review/submit. Common fields include a headline, summary, news date, name, research group, optional supporting link, release preference, and accuracy/permission confirmation.

| Category | Main details |
| --- | --- |
| Publications | Up to ten papers, each with title, authors, venue, publication status, DOI/URL, abstract, optional date, comments to the office, and more information |
| Grants | Project title, funder, principal investigator, award status; optional amount, amount-publication permission, dates, collaborators |
| Student milestones | Student, achievement, degree/program, adviser; optional thesis title and destination |
| Awards | Recipient, award, organization; optional significance |
| Presentations | Presenter, title, host, type; optional location |
| Outreach | Activity, organizers, audience; optional partners and impact |
| Media | Person/research featured, outlet, headline; optional coverage link |
| Announcements | Type, people; optional location, time, registration link |
| Other | People involved and additional details |

Images are optional: JPEG/PNG/WebP, up to three per paper or other news item, 10 MB each and 30 MB total per submission. Caption, credit, alternative text, and permission status accompany each image. Server validation checks actual bytes and limits.

## Outputs and review

The private office inbox is the primary output. It provides search, category/status filters, a refresh control, complete story/image previews, private notes, review history, and an archive. Submitted → In review → Approved → Published → Archived is the editorial workflow; Changes requested records the need for office follow-up. No action publishes to an external website or emails anyone.

Excel exports contain category sheets and linked media metadata; publication sheets use one row per paper. ZIP packages add the images and a readable digest. Internal exports retain office notes. Editorial-copy exports omit private notes, office comments, and restricted grant amounts, and honor embargoes and image permissions. A complete JSON backup preserves records and images for recovery.

## Architecture implemented locally

- Dependency-free HTML/CSS/JavaScript interface and Node server.
- Private records and images on disk outside the public directory, with atomic saves and version-conflict protection.
- Signed, HttpOnly contributor cookies for browser-specific drafts, lasting up to 30 days. No external identity provider; submitted names are self-reported.
- Server-checked office password with salted hashing, failed-attempt throttling, and 30-minute sessions. Server endpoints enforce record/image permissions.
- 1,000-record / 256 MB safety cap for this single-process pilot; reaching it stops saves without any paid upgrade.
- Earlier browser preview records recoverable without deleting their original copies. Existing IDs are never overwritten during import.
- No Google connection, billing integration, external fonts, analytics, CDN, or email transport.

## Hosting and remaining launch work

Keep code on GitHub; keep private records, passwords, and signing keys out of the repository. GitHub Pages is static hosting and cannot run the private server. Use an existing department-managed server with HTTPS and persistent storage only if available at no additional charge. The current preview stays on localhost until a suitable hosting destination is selected and reviewed.

Before public use: configure the actual hostname and origin policy, HTTPS and secure cookies, request/rate and storage controls, administrator-controlled first setup, office credential policy, backups, retention, and a recovery test. A shared office password identifies the office role but not individual reviewers. Confirm whether named staff accounts are needed before deployment.

Password-change email to the designated administrator was requested earlier, but no email transport is configured. Keep this explicitly unavailable until an approved free delivery arrangement exists. Do not send any other emails without permission. Do not promise perpetual free third-party hosting or create billing accounts.

The local preview must be reviewed before deployment. No hosting account, cloud resource, repository publication, or email has been created by this update.
