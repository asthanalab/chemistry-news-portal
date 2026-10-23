# Chemistry News Portal

A private departmental news intake and review portal. Contributors need only their name and research group. **No Google account, subscription, paid API, or external database is required.** Office staff read submissions, view images, manage review status, and export Excel files inside the portal.

## Run the local preview

With Node.js 20 or later:

```sh
node server.mjs
```

Open [the portal](http://127.0.0.1:4173), or double-click `start-preview.command` on this Mac. The server listens only on `127.0.0.1`; this preview is not accessible from other computers. Stop the server with Ctrl+C. There are no packages to install.

## Contributor workflow

1. Open the link and select **Submit news**. No account or institutional email is required.
2. Choose a category and enter a name and research group. Students, faculty, and staff can submit.
3. Add the story, optional images, and release preferences; review and submit.
4. Keep the reference receipt. Submitted records are visible only to the office.

The home page keeps its header, navigation, and footer, with a centered Submit news link. The search, filters, and submission list belong to the office dashboard.

Drafts are saved on the portal server. A signed, HttpOnly cookie identifies this browser for up to 30 days. **My drafts** contains only drafts created by that browser. Another browser or device cannot recover them without office help. Clearing cookies removes access to drafts, but does not delete records from the server. Names and group affiliations are self-reported, not independently verified.

## Office workflow

Open **Office access** and enter the office password. The inbox supports searching, category/status filters, image viewing, private notes, status updates, archiving, and Excel/media downloads. **Refresh** retrieves new submissions without leaving the dashboard; navigating to the inbox also reloads it.

The password is checked by the server using a unique salt and 600,000 PBKDF2-SHA256 iterations. Only a hash of the derived proof is stored. Office cookies are HttpOnly and SameSite=Strict. Sessions expire after 30 minutes; **Lock office** revokes access. Five failed password attempts pause login for five minutes. Server endpoints enforce permissions independently of the interface: contributors cannot read submitted records or attachments, even by guessing an identifier or changing their browser's role.

This checkout retains the previously configured office password. On a fresh local installation, the first office visit offers one-time password setup. `node configure-office-password.mjs` is an alternative that creates a password and displays it once; it does not replace an existing credential.

**Email is not connected.** No submission, review, or password-change email is sent by the built-in server. The password-change dialog explains that recovery email needs administrator setup. The earlier request for administrator-only recovery email remains pending; it is not a Google sign-in requirement for using the portal.

## Included

- Publications, grants, student milestones, awards, presentations, outreach, media coverage, announcements, and other news.
- Up to ten publications per submission, each with its own title, authors, venue, status, DOI/URL, abstract, optional date, comments to the office, and additional information.
- Up to three JPEG, PNG, or WebP images per publication or other news item; 10 MB per image and 30 MB per submission. Captions, credits, alternative text, and permission status accompany images.
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

The earlier IndexedDB and Google adapters are retained as inactive legacy code for reference. They are not used in server mode, and no Google scripts are loaded or requests sent to Google.

## Hosting and cost

The code can be kept on GitHub. A shared private inbox also needs a running server with persistent storage. **GitHub Pages cannot run this Node backend**; it is a static hosting service. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

The intended next step is an existing department-managed server with HTTPS and persistent private storage, if the department provides one at no additional charge. Before launch, configure its hostname/origin checks, secure cookies, abuse controls, backup/restore process, retention policy, and office access policy. The current server deliberately accepts only loopback addresses and must not be exposed unchanged.

There are no billing integrations, automatic upgrades, external paid dependencies, or usage-based charges in this package. No public deployment has been made. Availability and operating costs of future hosting cannot be guaranteed forever; no paid hosting should be enabled without the user's approval.

## Files and checks

| File | Purpose |
| --- | --- |
| `public/` | Browser interface, form model, and export generation |
| `server.mjs` | Static files and private API routing, bound to loopback |
| `portal-store.mjs` | Persistent records, image validation, contributor sessions, permissions, imports |
| `office-auth.mjs` | Password verification, rate limiting, and office sessions |
| `.local/` | Private runtime data; never publish or commit |
| `tests/` | Access controls, persistence, validation, concurrency, exports, and legacy regression checks |
| `google-backend/` | Inactive earlier integration; not required or connected |

Run `node --test tests/*.test.mjs`. Some integration tests open temporary loopback ports. Test records are synthetic and isolated from the preview's data. Tests do not send emails.
