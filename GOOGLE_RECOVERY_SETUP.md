# Administrator Google recovery

Only `ayushasthana15@gmail.com` is approved to recover the office password. The UND email remains the department contact. Recovery requests only `openid email`, with no Gmail, Drive, calendar, contacts or offline-access scopes. No email is sent. Contributors do not need Google accounts.

## Google client

Use the dedicated **UND Chemistry Portal Recovery** project in Google Auth Platform. No billing account or paid product is required by this implementation. Configure an external application in testing mode with only the approved administrator as a test user. Add a Web application OAuth client with this exact authorized redirect:

`https://chemistry-news-portal.chemistry-newsroom.workers.dev/api/office/google-callback`

Keep its client secret private. Store `{"clientId":"…","clientSecret":"…"}` in the Worker secret `GOOGLE_OAUTH`, never in GitHub or public assets. `PORTAL_ORIGIN` is the exact portal HTTPS origin. `PORTAL_RECOVERY_GOOGLE_EMAIL` identifies the approved Google account and is checked by the server; selecting an account in Google's interface is not authorization by itself. Use the portal's `/privacy.html` as its privacy disclosure.

Google's policy acceptance and security-sensitive client connection require the owner's approval. The owner approved this setup and the production update on October 27, 2026. The current activation state is recorded in PROJECT_NOTES.md.

## Recovery behavior

1. Select **Forgot password? → Continue with Google** on the office login page.
2. Sign in as the approved administrator. Google handles its own password, passkey or multifactor challenge; the portal never receives the Google password.
3. The server validates Google's signature, issuer, audience, expiry, nonce, verified email and exact approved account. The redirect is tied to the originating browser, single-use state and PKCE. A different Google account is rejected.
4. Choose a new office password privately. The form asks for at least 12 characters. The recovery capability expires in 20 minutes and works once; the old password remains active until the new one is saved.
5. Every office session and outstanding recovery flow is revoked. Sign in normally using the new password.

Recovery does not automatically open the inbox. It is an intentionally approved alternative proof of administrator identity, so protect the approved Google account with its own strong authentication. Losing both Google access and the portal password requires hosting-account recovery.

## Maintenance and emergency recovery

- Change the allowed Google account only through the hosting configuration and a reviewed deployment. The server pins the verified Google subject identifier for the configured email on first successful recovery. A different subject for the same email is rejected.
- A hosting administrator can rotate `OFFICE_CREDENTIAL` to a newly salted credential. This overrides an in-app password change and invalidates its office sessions and reset links. Keep that credential out of public files and logs.
- `GOOGLE_OAUTH` can be removed to disable Google recovery. Ordinary office password login and Drive backups continue to work.
- Google access and refresh tokens are not retained. Account ID/email and temporary recovery state are private Cloudflare data. Recovery state expires and is removed during subsequent activity or password rotation.
- The script used for Drive backups remains Drive-only. It cannot issue password resets or modify credentials. No email-sending service or scheduled email job is configured.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google identity permissions](https://developers.google.com/identity/oauth2/web/guides/how-user-authz-works), [JOSE verification library](https://github.com/panva/jose).
