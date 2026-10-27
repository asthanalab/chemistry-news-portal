# Current security verification — October 27, 2026

The final Google-only recovery revision passed **67 isolated automated tests**, including **12 in the actual local Cloudflare runtime**. Checks cover forged office cookies/roles; private record/image/settings/import/delete access; cross-site password actions; current-password proof; concurrent reset use; logout and session revocation; reset expiry; hosting-secret recovery; signed Google identity validation; wrong/unverified accounts; audience/issuer/nonce mismatch; altered/unsigned JWTs; state/browser binding; PKCE; replay; code-exchange failure; exact identity-only scopes and disabled email routes.

The Workers integration test completes an entire signed Google recovery using synthetic keys and credentials through the runtime's native outgoing-request API. It verifies reset completion, old-password rejection, old-session revocation and one-use capabilities. A token-endpoint redirect is rejected without forwarding client credentials. This test covers the native-fetch compatibility issue found and corrected during live verification.

**17 bounded live access checks passed** on final deployment `86224b8b-c4d5-4b7b-996a-080d40e176fd`: anonymous/forged office access, submitted-record isolation, configured identity-only recovery, cross-origin rejection, no public setup, static-file boundaries and browser security headers. A real Google sign-in as the approved administrator reached the new-password form. The fields were left blank: live password replacement was deliberately not performed. The private status confirmed successful Google verification, four existing records, and the unchanged enabled Drive backup connection. Temporary verification office access was locked afterward. No live records were edited or deleted and no email was sent.

JavaScript syntax and the production build passed. Local browser checks confirmed the login barrier for a direct dashboard route, normal login, the current-password form, logout and rejection of a fabricated recovery link. The user approved Google identity-only setup and deployment. Google requested only the account email address, with no Gmail or Drive scope. The mail-sender prototype is superseded and is not part of the active application. Private receipts and sign-in screenshots are ignored under `.local/`.

This is a bounded application review, not a guarantee against every attack. The unchanged existing password should be replaced privately with a strong unique passphrase. Protect the approved recovery Google account as well.

The results below are historical unless explicitly dated as this revision.

# Validation history

Current status as of October 27, 2026: the full local suite passed **55 tests**, and the upload/deletion/Drive-only retention implementation is deployed as Cloudflare version `4573f7c7-4e78-4674-b35b-1a2f87dac970`. Google Drive-only authorization, private root folder, verified initial backup and automatic-cleanup activation are complete. No Gmail access, email-sending scope, real email, or live deletion was used.

## October 27 current revision

- Live Drive verification: all four current records and two images backed up. Independently downloaded files matched manifest SHA-256 checksums. The real local import restored all four records, private notes, history and exact image bytes into an isolated store; repeat import skipped duplicates. No live records were deleted.
- Verified the backup folder is directly under My Drive and the root, dated folder and all five files have owner-only access. Automatic retention was enabled only after this verification.

- All 55 isolated tests passed, including 209 MiB trigger / 50 MiB latest-news retention, immutable backup snapshots, draft/new-edit preservation, file verification failures, signed-request tampering/replay rejection, exact Google permission list, disabled email endpoints, office-only per-item delete and stale-version rejection.
- Browser upload of a synthetic 15,877,193-byte PNG compressed to a displayed 4.4 MB WebP, with image preview, completed local submission and office review.
- Delete confirmation identified the intended synthetic item; cancelled without deleting it. Automated isolated backend tests verify actual deletion and attachment access removal.
- Public asset build succeeded. Deployment preserved the existing Worker, Durable Object and private records. Local test records were not uploaded.
- Google project manifest contains only `drive.file`, `script.external_request`, and `script.scriptapp`. No Gmail, send-mail, user-email or whole-Drive scope. No public Google web app is needed.

The sections below preserve historical stages, including inactive legacy Google email tests. They do not describe the current email policy or prove a live Google backup. See PROJECT_NOTES.md for the current status.

## First-version validation

Validated locally on October 23, 2026.

## Automated checks

`node --test tests/*.test.mjs`: **28 passed, 0 failed**.

Coverage includes required/category fields, student submissions without email entry, embargo and permission holds, private-data exclusion from publication workbooks, grant-amount withholding, literal spreadsheet values, real ZIP/XLSX generation, backend identity audience/verification/access-list checks, unsupported-image rejection, contributor ownership checks, password sessions, simulated password-change email delivery, and absence of public file sharing.

The generated workbook was opened with `openpyxl`; its ZIP integrity check passed and its category sheets were readable.

## Browser checks

Tested in the in-app browser against `http://127.0.0.1:4173`:

- Dashboard renders with fictional examples; desktop and narrow layouts inspected.
- Empty required fields block advancing and show field-level errors.
- A fictional publication was entered through all four steps.
- A generated PNG was uploaded and displayed in the preview with caption, credit, and alternative text.
- The submission returned an on-screen reference and appeared in the review view.
- Approval and archival updates persisted with an activity history.
- Search narrowed the dashboard to the matching grant story.
- Reload preserved stored submissions.
- The browser-generated publication workbook was downloaded and independently opened with `openpyxl`. Unicode `CO₂` was preserved, image metadata was present, and the submitter email/private note were excluded.
- The media ZIP passed an independent integrity check. Its image bytes exactly matched the uploaded PNG, its workbook opened, and the HTML digest excluded private notes and contact details.
- At a 594 px viewport, the page width matched the viewport after fixing the narrow-screen overflow; the table scrolls within its own container.
- The test story was archived, leaving the primary sample dashboard clean. No real personal or research data was used.

## Limits

Google sign-in, live Apps Script cross-origin calls, shared-account permissions, live email delivery, and live service quotas require a real configured deployment and have not been integration-tested. The backend's token-info verification is a pilot implementation; the Google setup guide records the required production authentication follow-up. No Google resources or GitHub deployment were created. No actual email was sent.

Local mode now checks the office password through the local server, but records still reside in this browser's IndexedDB and remain accessible to a person with access to that storage or modified browser code. It is not a shared production service. Backups are necessary before clearing browser storage.

## Office password and password-change revision

Replaced the unrestricted office demonstration button with a password form. The selected password is stored only as a salted verifier in an ignored private file; it is absent from frontend source. Password derivation uses PBKDF2-SHA256 with 600,000 iterations. The local server issues an HttpOnly, SameSite=Strict session cookie, expires access after 30 minutes, rejects other origins for mutations, and pauses repeated guesses. The shared Google adapter requires both an allowlisted Google identity and the password session for office access.

The user explicitly authorized administrator password-change emails. A prepared Google endpoint sends a one-use 20-minute link only to the configured administrator and requires that exact verified account to complete the change. Current password and sessions remain unchanged when requesting a link; completing it invalidates prior office sessions. The local Change password dialog explains that email delivery requires the Google connection and disables its send button.

Seven additional tests verify browser/server password-proof compatibility, absence of plaintext persistence, local login/lock/logout/expiry, first-time setup, Google allowlist plus password enforcement, cross-account session rejection, reset recipient/redirect injection rejection, expiry, single use, password rotation, and delivery failure. Tests use synthetic messages captured in memory; no actual email was sent. Browser checks confirmed rejection of an incorrect password, successful unlock with the selected password, the office inbox and export button, and return to the password gate after Lock office.

## Office-only intake revision

The default page is the contributor form. Contributors see only their own unfinished drafts, with no inbox, archive, review, or export controls. After submission they receive a reference receipt; the submitted content and images are available only in the office view. Direct office links are gated, and switching back from the office preview clears cached records, images, form contents, and export selections. Local mode refuses to initialize on a public hostname. The initial demonstration button was subsequently replaced by the password flow described above.

Six added automated checks exercise both access policies and the Apps Script request handlers: every submitted status is office-only; spoofed roles cannot expand access; guessed image IDs are rejected before Drive access; unauthenticated requests cannot read storage; draft responses exclude office history; and a submitted record cannot be changed by its contributor. The complete save path was checked with stubbed Sheets/Drive services, including the receipt-only response and a successful office review update. These checks do not replace live Google integration testing.

Browser verification used a fictional news item with a synthetic PNG (reference `CN-2026-50AFDF`). Its draft was visible only in the contributor's draft list. Submission removed it from that list and returned a receipt without a review link. Reloading the old edit URL did not reveal the submitted content. The dashboard URL showed Office access; the separate local office demonstration opened the record with its private note and image. The office Excel download was opened independently with `openpyxl`, and its reference, private note, and image metadata were verified. The test record was archived; existing user drafts were preserved.

## Simplified interface revision

Replaced the original color theme, serif headings, sidebar, overview cards, and decorative copy with a white Arial interface, a horizontal navigation bar, and a plain submissions table. Replaced category cards with a native select. Verified in the browser that changing the category loads the correct grant fields, and restored the fictional draft to its original publication category. Saving and navigation remained functional. Narrow screens show the essential table columns; the complete information remains available in each submission.

## Multiple-publication revision

Added up to ten publications per submission, each with its own title, authors, venue, status, DOI/URL, abstract, optional date, and up to three images. The contact details, public summary, editorial status, and release instructions apply to the submission as a whole. Existing single-paper records need no migration.

New checks cover validation of later papers, image ownership and limits, removal, legacy compatibility, one Excel row per paper, export privacy, and backend validation/preservation of the additional papers. The generated XLSX was also opened with `openpyxl` to independently verify Unicode and image-to-paper mapping.

Browser verification used a fictional two-paper submission (reference `CN-2026-CAE118`). A blank second paper blocked Continue. Both papers survived save/reload. An image was uploaded specifically to paper two; removing that paper and using Undo restored its details and attachment metadata. Submission and review displayed both papers and placed the image under the second paper. The browser media export was downloaded and independently inspected: two publication rows, both abstracts in the digest, and the correct second-paper image mapping and image file. The test submission was archived after verification. Evidence is saved under the ignored `test-results/` directory. No external service was connected or email sent.

## Student contributor revision

The contributor section now asks only for name and research group. Removed the institutional email input and faculty-specific group wording, including the dashboard/export group labels. Frontend and backend submission validation accept a student record with no email field. Shared-mode identity still comes from Google sign-in. All 14 checks pass; the refreshed local form was visually checked and captured in `test-results/student-friendly-form.png`.

## Publication comments and additional information

Added optional “Comments to the office” and “More information” text areas to every publication, including additional papers. Both appear in internal review and internal Excel/media exports. Office comments are labeled private and excluded from publication-copy workbook columns and the media digest; the digest and workbook share the same field selection. Google backend validation preserves both fields with a 6,000-character limit. All 15 checks pass, including first/additional-paper privacy, backend preservation, and field limits. The refreshed browser form shows both optional sections; no sample submission was changed during this check.

## Minimal home page revision

The home page retains the Chemistry news header, navigation (including My drafts, Office access, and Help), and footer. Its main content is a centered Submit news link, with no submissions table, submission count, search, category filter, or empty-state message. The link opens the existing form, and Back to home returns to the landing page. Office dashboards and saved drafts retain their existing workflows. JavaScript syntax was checked; browser verification confirmed the restored page structure, submission link, return link, and office password screen. The updated preview is captured in test-results/home-with-navigation.png. No records were changed.

## Account-free portal and private server storage

The default mode is now `server`. Contributors do not sign in to Google or connect an account. The built-in Node server persists records and image data outside the public directory. Signed, HttpOnly contributor cookies isolate browser drafts; an office password session is required to read submitted records and images. Incoming role, owner, review-note, and sample flags cannot grant privileges. Saves use version checks and an atomic file replacement, with an explicit storage cap and no billing path.

All 33 automated checks passed. New HTTP integration checks cover two isolated contributor browsers, office-only submitted-record/image access, minimal submission receipts, forged cookies/roles, session expiry, server-side image/form validation, cross-site request rejection, concurrent-edit conflicts, persistence after storage restart, atomic non-overwriting imports, and preservation of the last committed data when capacity is exceeded. Existing password and Excel/export privacy checks also passed. The tests use temporary directories and local ports; they do not send emails.

Browser verification confirmed that the open Student milestone draft retained its name, research group, category, and edit route after migration. Eleven additional earlier preview records were imported into server storage without overwriting that draft; original browser copies remain intact. The office opened with its existing password and no Google step. A previously archived two-paper submission displayed both abstracts, the second paper's image, and the original review history. Its Excel export completed through the interface. Reload retained the authenticated office view. Office settings now describe private portal storage, backups, and the unconfigured recovery email instead of Google setup. Navigation wraps on narrow pages, and the existing plain white/Arial presentation is retained.

The preview remains loopback-only at http://127.0.0.1:4173. Public hosting, HTTPS/origin configuration, internet-facing abuse controls, and password-recovery email remain launch work; no public deployment or email delivery was performed. Evidence: test-results/account-free-settings.png and test-results/account-free-office-inbox.png.

## Cloudflare backend, 2026-10-23

- 38 automated tests pass, including five tests in the actual local Workers runtime.
- Checked separate contributor drafts, submitted-record/image privacy, forged roles and cookies, same-origin writes, office lockout, optimistic version conflicts, atomic imports, capacity rejection, and image chunking/removal.
- Browser preview on port 4174 submitted a fictional publication with a PNG, opened it through the office password gate, displayed its private office comment and image, and downloaded an XLSX. The downloaded file is a valid ZIP workbook.
- Production dry-run bundles 11 static assets and the Worker. Private data and credentials are excluded.
- Local original preview on port 4173 and user drafts remain separate and intact.
- Live deployment verification completed after explicit Wrangler authorization; see below.

## Live deployment, 2026-10-23

- Public source: https://github.com/asthanalab/chemistry-news-portal at commit d3cbc87356c6bc9ad6e0dcf62bff57ce3349fcc4. All 34 published files match the local source by Git blob hash; no private runtime files, credentials, screenshots, or backups were published.
- GitHub Pages builds from main:/docs. Its successful workflow is https://github.com/asthanalab/chemistry-news-portal/actions/runs/40033176151. The entry link https://asthanalab.github.io/chemistry-news-portal/ was opened in the browser and redirected successfully to the HTTPS portal.
- Working portal: https://chemistry-news-portal.chemistry-newsroom.workers.dev/. The Worker serves the interface and private API; GitHub hosts its source and entry page.
- Cloudflare Workers Free ($0) was verified in the account dashboard. No billing details, paid plan, R2 bucket, or email transport was configured. The office verifier was installed as a private Worker secret through Wrangler input, without publishing it.
- Live browser verification created one fictional publication with a PNG, submitted it, and received reference CN-2026-F0E8D5F6. The submission left the contributor draft list and was visible after office password authentication. Its image and private office comment rendered correctly.
- The live Excel export downloaded successfully. Independent ZIP/XML inspection confirmed a valid workbook containing the reference, office comment, and image metadata.
- The fictional test was moved to Archived and kept for verification evidence. No actual departmental submission was uploaded during deployment. Existing local preview records remain local.
- Lock office returned to the password gate. A separate contributor session saw an empty submission list, received 404 for the known archived test record, and remained unauthenticated for office access.
- Evidence: test-results/live-portal-home.png and test-results/live-office-review.png. No email was sent. Email password recovery remains unconfigured.

## UND department label, 2026-10-27

Changed the shared presentation setting to “UND Department of Chemistry.” JavaScript syntax and the production asset build passed. Published public/config.js to asthanalab/chemistry-news-portal and verified its Git blob hash against the local file. Cloudflare deployed version da9fd252-77cd-4b08-8eb0-fffe18504c05 with only config.js changed among static assets. The GitHub Pages entry link opened the live portal with the updated header; evidence is test-results/und-portal-home.png. No records, credentials, or hosting limits were changed.

## Project notes and Microsoft setup check, 2026-10-27

Consolidated the current status, user decisions, hosting locations, backup safeguards, and remaining work in PROJECT_NOTES.md. Added MICROSOFT_SETUP.md with the observed university app-registration blocker and proposed IT handoff, plus AGENTS.md instructions to maintain project notes locally and in the existing GitHub repository. Updated the README and plan and marked earlier validation stages as historical. Local Markdown file links and credential-pattern checks passed for the six documentation files. Application code was unchanged; the application test suite was not rerun for this documentation update.

University Microsoft sign-in succeeded, but New registration returned “You do not have access” (401). No application, permissions, backup folder, email transport, or cleanup job was created. No email or private data was sent.

## Footer wording, 2026-10-27

Replaced the footer suffix “No automatic emails.” with the exact requested text “AI generate tool.” The hosted footer now reads “Private departmental submissions. AI generate tool.” JavaScript syntax and the production asset build passed. The published public/app.js Git blob hash matched the local copy (`f0e6c22390e40a95e2477c1ae046b1ba3b79a979`). Cloudflare deployed version `c7e75de4-c093-485a-ac77-28409ef78daa`, updating only app.js among static assets. Browser verification confirmed the exact wording on the live home page. The change affects presentation only; no email or AI service was enabled. The full application suite was not rerun for this text-only change. Evidence: test-results/live-footer-ai-generate-tool.png.

## October 27 footer grammar correction

Changed the live footer to “Private departmental submissions. AI generated tool.” Syntax and asset build passed; browser verification confirmed the exact text. Cloudflare version `39dec5ce-5d7c-4497-93ff-0fcbc6c5c4f3` changed only app.js among static assets. The full suite was not rerun for this wording-only edit. Evidence: test-results/live-footer-ai-generated-tool.png.
