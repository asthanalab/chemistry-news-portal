# Project working instructions

## Project notes

The user requested that all project notes be kept in this project folder and in [asthanalab/chemistry-news-portal](https://github.com/asthanalab/chemistry-news-portal).

- Read `PROJECT_NOTES.md` and `README.md` before continuing work.
- Update `PROJECT_NOTES.md` when decisions, implementation status, blockers, account choices, or next steps change.
- Update `PLATFORM_PLAN.md` when scope changes and append relevant completed checks to `VALIDATION.md`. Label older validation as historical; do not describe old test results as newly rerun.
- Publish the reviewed, non-sensitive project notes to the existing repository when completing project work, and verify that the GitHub files match the local copies. If publishing is blocked, record that explicitly rather than claiming synchronization.
- Keep private operational details under ignored `.local/` when needed. Never commit credentials, password verifiers, OAuth tokens, session cookies, private submissions, images, backups, or account/sign-in screenshots. A request to publish project notes is not permission to publish these materials.
- Keep the repository's deployment `docs/index.html` intact; it is the GitHub Pages redirect.

## Product constraints

- Preserve the plain white/Arial interface, UND Department of Chemistry label, and name/research-group contributor workflow.
- Submissions and images are office-only after submission. Do not weaken server-side access checks.
- Free services only. Do not enable billing, paid plans, paid resources, or automatic purchases.
- The current choice is private Google Drive backups under the existing Gmail account, with no Gmail read access and no email-sending permission. Do not send any automated emails, including password resets. Microsoft/OneDrive and earlier mail proposals are superseded. A browser sign-in alone does not connect backups.
- Check storage daily on Google servers. At 209 MB, verify a recoverable Drive backup before removing older news; retain roughly the newest 50 MB of whole items plus drafts and changed/new records. Never enable cleanup before verifying an initial backup. Keep the backup folder at My Drive root; a missing/shared/full destination must stop cleanup.
- Do not send unrelated emails. Do not enable automatic cleanup before verifying a complete recoverable backup and documenting the exact cleanup scope.
- Preserve existing records, drafts, and credentials. Use synthetic, isolated data for tests.
- Keep local preview data separate from hosted records. Do not automatically import local data during deployment.

The broader user safety instructions still apply. This file does not grant additional remote-access, credential, billing, or deletion permissions.
