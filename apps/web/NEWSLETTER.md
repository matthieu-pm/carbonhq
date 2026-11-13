# Newsletter signup

The homepage form subscribes immediately through `/api/newsletter`. Resend stores the contacts in the **Carbon newsletter** segment. When `RESEND_WELCOME_TEMPLATE_ID` is configured, the route also sends the approved welcome email. Existing account-wide unsubscribes stay unsubscribed.

From `apps/web`:

1. Copy `.env.example` to `.env.local` and set `RESEND_API_KEY`. The key needs permission to manage Contacts and Segments. `.env.local` stays out of Git.
2. Run `pnpm newsletter:setup`. It creates or reuses the segment and writes `RESEND_NEWSLETTER_SEGMENT_ID` into `.env.local`.
3. Run `pnpm dev`.

Set `RESEND_API_KEY`, `RESEND_NEWSLETTER_SEGMENT_ID`, and `RESEND_WELCOME_TEMPLATE_ID` in the website’s Vercel environment before deploying with automatic welcomes. None uses the `NEXT_PUBLIC_` prefix. Never put the key in frontend code. Without the welcome template setting, signup still works and sends no welcome.

Run `pnpm test:newsletter` for API validation, repeats, opt-outs, upstream failures, and credential redaction. These tests mock Resend and create no contacts.

Newsletters are sent separately through Resend Broadcasts to this segment. Keep Resend’s unsubscribe link in each newsletter.

## Email templates

The dark and light designs from `/preview/newsletter` also live in Resend Templates as **Carbon newsletter — Dark** and **Carbon newsletter — Light**. Both are drafts. The original preview stays unchanged.

`pnpm newsletter:templates` generates responsive table-based HTML in `emails/generated`. Add `--upload` to create or update the corresponding Resend drafts. The command verifies the saved HTML and refuses to replace a published template.

These copies preserve the mockup’s sample release copy and marked placeholders. Replace the image boxes, quote, community links, and sender details before using them. `VIEW_ONLINE_URL` is a required template variable; the unsubscribe link uses Resend’s reserved `RESEND_UNSUBSCRIBE_URL` token.

Resend’s Templates API serves transactional templates. To send a newsletter Broadcast, use the same generated HTML as its content and target the Carbon newsletter segment. Importing these templates does not create or send a Broadcast.

## Approved welcome email

`pnpm newsletter:welcome` generates `carbon-welcome.html` and `carbon-welcome.txt`. The **Carbon welcome** template is published in Resend. Its approved HTML is captured in `carbon-welcome-approved.html`; the sender is `Carbon <newsletter@carbonhq.sh>` and the subject is `Welcome to Carbon`. The separate **Carbon welcome — current subscribers** Broadcast remains a draft because the segment had zero subscribers at launch. The upload command refuses to replace a published template.

Automatic welcomes use the signup route and Resend’s `/emails` API, rather than the Events API. This supplies the idempotency guarantee needed for retries. The previously drafted **Carbon welcome — future newsletter subscribers** automation stays disabled and unused, so there is only one delivery path. IDs and current statuses are in `emails/generated/resend-welcome.json`.

After copy approval, `pnpm newsletter:welcome-enable --send-current` verifies the approved content, publishes the template if needed, creates the `carbon_welcome` string property, and configures the local template ID. It sends the approved Broadcast only if there are current subscribed contacts and it is still a draft. Running it does not deploy the website or set Vercel variables.

The signup route records a pending welcome attempt on the contact before sending with the stable key `carbon-welcome/<contact-id>`. It records the returned email ID after acceptance and skips recorded welcomes on future submissions. A pending attempt retries the same template and key for at most 23 hours, within Resend’s 24-hour idempotency window. Older or malformed records require provider reconciliation; they are never automatically sent again. A welcome failure leaves the subscription intact and the attempt pending for a safe retry.

Acceptance uses Resend’s `delivered+label@resend.dev` simulation to check delivery, repeat signup suppression, and recovery from an unknown result returning the original email ID. Remove disposable test contacts after verification. Production requires the website deployment and the three server-side environment variables above.
