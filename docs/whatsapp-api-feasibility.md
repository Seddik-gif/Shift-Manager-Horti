# WhatsApp: official API feasibility (checked 2026-11-09)

Source: Meta "Groups API" documentation (developers.facebook.com → WhatsApp → Business Messaging → Groups).

## Verdict

**Automatic delivery to the existing Horti Magici staff group is not supported by anything documented, so it is not built.**
The app uses the manual flow (copy → open WhatsApp Web → paste → confirm) for every send.

## What the official Groups API does

- Groups are **created through the API** (`POST /<PHONE_NUMBER_ID>/groups`). The docs describe no way to adopt, import or
  attach a group that already exists, and no way to add members directly: people join only via an invite link the business sends.
  The documentation is *silent* on existing groups (it neither allows nor forbids them), so it must be treated as unsupported
  until Meta confirms otherwise in writing.
- Maximum **8 participants** per group (Quick facts). Horti Magici's staff group may be larger.
- Requires an **Official Business Account (OBA)**, and a number on **Cloud API** – *not* the WhatsApp Business app number
  and not Multi-solution Conversations numbers. A staff group run from an ordinary phone cannot be linked.
- Priced per message (separate pricing page).
- Unsupported message types include interactive, commerce and view-once.

## What would be needed if the team ever wants automation

A *new* API-created group (≤ 8 people, everyone joins via invite link), an OBA, a dedicated Cloud API number, webhooks, and a
decision that the old group is retired. This contradicts "do not create a new group", so it is deliberately not implemented.
If Meta confirms that an existing group can be attached, only a new `sendToGroup` service needs adding; publication must keep
working when it fails.

## Rules this app follows

- No unofficial libraries, no WhatsApp Web scraping or automation, no stored WhatsApp credentials.
- "Copied" and "opened WhatsApp Web" are tracked as facts the app observed; "sent" is only the admin's **manual confirmation**
  (`whatsapp_shares.confirmed_sent_at`, audit action `whatsapp.share_confirmed`). The UI says WhatsApp did not verify delivery.
