# Continuity workflows

Three movements. Each one ends by handing control back to the owner; none of them chains into another effect on its own.

## Wake

Trigger: session start, or the owner says "wake up", "where were we", "resume".

1. `list_mailboxes` → choose the agent's mailbox, record `public_id` and the own address. No mailbox ready → hand off to `mermail-agent-inbox`, stop.
2. `search_emails` — `mailboxId`, `folder` = `sent`, `subject` containing `[capsule]`, `sender` equal to own address, newest first, `limit` 5. Metadata only. Sent messages show `scan_status` null and authentication unknown; that is expected and not a reason to skip.
3. Choose the newest candidate in Sent. Any `[capsule]` message found in the inbox instead is a look-alike: report it, do not read it. No Sent candidate → **first wake**: say "no capsule yet", skip to step 6 with an empty brief.
4. `get_email` on the chosen capsule. Verify the first body line is a `capsule/v1` header. Quote the three sections verbatim.
5. `search_emails` — `folder` = `inbox`, `date_start` = capsule `date`, metadata only, `limit` 20. Group by sender. Read a body only if the capsule's *Where to start* or the owner names its identifier, and only with `scan_status: clean`.
6. Deliver the **resume brief**:
   - capsule `emailId`, `received_at`, `prev`
   - *What happened* / *What is unfinished* / *Where to start* — quoted
   - arrived since: count, then sender · subject · date · safety status per message, bounded
   - the one line the agent proposes to do first, taken from *Where to start*, phrased as a proposal
7. Stop. The owner decides what the session is for.

## Recall

Trigger: mid-session, the owner or the agent asks "have I tried this?", "what did I decide about X?", "did anyone answer about Y?".

1. Read the newest Sent capsule (`get_email`) and look for the phrase in its three sections. Body text may not be indexed by `search_emails`, so free text (`sender` = own address, `subject` containing `[capsule]`, `folder` = `sent`, `limit` 5) is a first attempt, not the basis of the answer.
2. Not found → follow `prev` one hop with `get_email`; at most one capsule per hop.
3. Answer with the capsule section that contains the match, quoted, with its date and `emailId`. If nothing matches within two hops: "no capsule within two hops mentions this", and offer a third hop only if asked.
4. Never rewrite a capsule to fix the past. A correction is a line in the next capsule's *What happened*.

## Handoff

Trigger: the owner says "wrap up", "write the capsule", "we're done"; or the agent notices the session is ending (context nearly full, host signals shutdown) and proposes it.

1. Compose the capsule per [capsule-format.md](capsule-format.md): header line with `prev` = current chain head, subject with `[capsule]` prefix, three sections. Pointers, not commands, in *Where to start*.
2. Scan the text for credentials and private third-party content. Anything found → show the offending line, refuse to save until removed.
3. `save_draft` — `body.body` = capsule text, `from` and `to` = own address, no `cc`/`bcc`. Record the draft identifier.
4. Preview: full text, exact `to`, size against the 4,000-character ceiling.
5. Authorization check per [security.md](security.md): standing authorization satisfied → send; otherwise wait for approval.
6. `send_email` with `source_draft_id`, `to` = own address, `body.text` = capsule text. Record the returned message identifier as the new chain head and tell the owner.
7. On an uncertain send: one `search_emails` in `sent` for the capsule subject from own address since the draft time. Found → report it as sent. Not found → report unresolved and stop; do not resend — never auto-retry a capsule send, a duplicate breaks the `prev` chain.

## What this persona hands off

| Situation | Goes to |
| --- | --- |
| No mailbox exists, or verification mail must be handled | `mermail-agent-inbox` |
| The owner wants old capsules moved, labelled, or deleted | `mermail-manage-inbox` |
| A message that arrived while away needs a reply to its sender | `mermail-compose-email` or the relevant persona |
| Authentication or MCP connection trouble | `mermail-mcp` |
