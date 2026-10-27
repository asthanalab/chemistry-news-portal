# Historical UND Microsoft setup — superseded

Updated: 2026-10-27. The user subsequently chose private Google Drive backups with no Gmail or email-sending permission. Do not carry out the mail/OneDrive proposal below. It is retained only as a historical record; no email was sent to IT.

## Verified blocker

University Microsoft sign-in succeeded. In the North Dakota University System directory, **App registrations → New registration** displayed **You do not have access**, error code **401**. No application was created. The cause and permitted registration route need confirmation from UND/NDUS IT; do not bypass university controls or substitute a different tenant without an approved design.

## Intended use

The UND Department of Chemistry news portal is hosted on Cloudflare Workers Free, with public source in [asthanalab/chemistry-news-portal](https://github.com/asthanalab/chemistry-news-portal). Incoming records and images remain private in the portal.

The requested Microsoft connection would:

- Use the UND mailbox to send administrator-only password reset and storage/backup notifications, initially to `ayush.asthana@und.edu`.
- Save verified private backups to a separate **UND Chemistry News Backups** folder in university OneDrive.
- Make that folder visible through the university OneDrive sync on the administrator's computer.
- Continue to allow contributors to submit without a Microsoft or Google account.

No additional paid license, Azure resource, billing account, or paid service is authorized.

## Information for UND/NDUS IT

Please confirm whether a departmental application may be registered for this purpose in the university tenant, or have IT create/manage an approved registration. The intended access is delegated to the designated administrator account, not access to all university users.

Proposed Microsoft Graph permissions, to be reviewed before granting:

| Permission | Purpose |
| --- | --- |
| `User.Read` | Confirm the connected account belongs to the intended administrator |
| `Mail.Send` | Send the specifically authorized administrative messages as the connected mailbox |
| `Files.ReadWrite.AppFolder` | Read/write the application's OneDrive backup folder, avoiding broad access to unrelated files |
| `offline_access` | Renew authorization for background backup and email jobs when no browser is open |

Do not request mailbox reading, directory-wide access, full-drive access, or application permissions spanning other users as a shortcut. Microsoft consent may describe `Mail.Send` more broadly than the portal's intended use; the application must restrict its own sending to the authorized administrative workflows.

Proposed application name: **UND Chemistry News Backups**. The OneDrive application-folder mechanism normally uses `Apps/{application name}`; verify the actual folder and local sync path during setup. Do not promise that the folder is already present or downloaded.

Use the production HTTPS portal origin, `https://chemistry-news-portal.chemistry-newsroom.workers.dev`, when designing the authorization callback. The exact callback route must be implemented and tested before it is registered. Client credentials, authorization codes, and refresh tokens must remain in private runtime storage, never public GitHub files or messages.

## Work remaining after registration access is resolved

1. Implement a supported Microsoft authorization flow, bind it to an authenticated office setup session, restrict the tenant/account, and validate the returned account and granted scopes.
2. Review the precise consent screen with the administrator before granting persistent access. Verify that the connected mailbox can send using the intended UND address.
3. Create the private application backup folder; confirm it online and in the correct local OneDrive sync. Keep a local copy downloaded if required. Creating a local folder alone does not connect the hosted portal.
4. Implement administrator settings and verified email changes, expiring one-use password resets, storage measurement, resumable backup, integrity verification, and a clear failure status.
5. Test using synthetic records and images, including export/restore, changed records, interrupted jobs, failed delivery, revoked authorization, and storage exhaustion. Do not purge real submissions during testing.
6. Enable only the approved workflows after validation. Automatic cleanup remains off until the exact backed-up versions and safe cleanup scope are verified. Preserve live data if backup or notification fails.

See [PROJECT_NOTES.md](PROJECT_NOTES.md#storage-rollover-design-requirements) for the requested storage margin and retention safeguards.

## Official references

- [Microsoft application registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- [OneDrive application folders](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)
- [Send mail with Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

A successful Microsoft browser sign-in or a chat-plugin connection does not grant this Cloudflare application background access. No email to IT or anyone else has been sent as part of this setup check.
