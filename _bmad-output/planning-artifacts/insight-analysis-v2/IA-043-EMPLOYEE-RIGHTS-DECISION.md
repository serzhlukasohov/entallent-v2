# IA-043 Employee Rights Boundary — decision required

Status: deferred for the development phase by the user on 2026-09-29. No employee-rights endpoint is approved or mounted. The current typed tenant retention policy remains authoritative. No user reset is required for this decision.

## Existing authority and implementation

- `SPEC.md` IA-040–043 bars organizational roles from original conversations and temporary or identifiable analytical records. IA-043 preserves employee export, deletion, and future self-review under a separate privacy and retention contract.
- ADR-008 says employees may read, correct, and delete their own conversations, memory, and goals. REQ-047 defines tenant retention categories, including temporary and permanent insights, but does not define a self-service identity protocol or export/deletion exceptions.
- `apps/api/src/users/users.module.ts` mounts no controllers. The archived `UserDataController` trusts a shared API key plus arbitrary `userId`, uses `DEFAULT_TENANT_ID`, limits exported messages to 500, omits V2 insight data, and makes a multi-table deletion without a transaction. It cannot be remounted as an employee-rights surface.
- `PRIVACY.md` has conflicting historical and current retention defaults. Neither set is established here as an approved customer promise.
- The active retention cleanup now covers V2 working, Bundle, and final insight tables using the typed tenant policy. A content-free withdrawal audit entry survives final insight expiry until the tenant audit cutoff. A production cleanup schedule has not been verified; PR #7 still defers the post-persistence withdrawal contract.

## Proposed boundary for approval

1. **Requester identity.** Active employees initiate through a signed personal Slack message associated with an existing linked tenant/person account. Former employees use a separate manual verification process. A copied Slack user ID, shared admin key, company-role cookie, or route `userId` must never establish self-authorization. The active intake must reject unsigned, non-DM, unlinked, inactive, and cross-tenant requests.
2. **Request state.** Persist a tenant-scoped request ID, verified person ID, request type, verification method/time, lifecycle status, and audit events. Keep request status and operational logs free of conversation text and analytical summaries. Destructive work begins only after the required identity and request confirmation steps.
3. **Export.** Define an explicit data inventory, including conversations, memory, goals, consent, survey evidence, temporary working insights, confirmed and final V2 insights, withdrawals, and report effects. Decide whether internal model metadata and already delivered aggregate reports are included. Avoid arbitrary result limits or incomplete exports; deliver through an approved private channel with expiry and access audit.
4. **Deletion.** Define which records are erased, redacted, or retained for legal and audit reasons; specify propagation to queues, derived analytical state, future model context, cohort eligibility, and pending report snapshots. Make the operation idempotent and resumable, with a durable completion receipt. Already delivered external reports require an explicit policy because they cannot be silently recalled.
5. **Retention.** Resolve the conflicting durations in `PRIVACY.md` and the precedence between a timely reply held across cutoff and the applicable temporary-content retention deadline. Use the typed tenant policy as the code source of truth once the product/legal values are approved.

## Acceptance criteria for implementation

- **Given** a signed request from a linked employee, **when** identity is resolved, **then** the server derives tenant and person from the verified channel account and never accepts an employee ID supplied by the caller as authority.
- **Given** another employee, a company-role session, or a shared API key, **when** the same export or deletion route is called, **then** the request is denied without reading private data.
- **Given** a valid export, **when** data spans more than one page and includes V2 records, **then** the complete approved inventory is produced for that tenant/person only, delivered privately, and audited.
- **Given** a confirmed deletion, **when** processing is interrupted and retried, **then** no erased source or derivative re-enters runtime context, analytics, queued effects, or later reports; the completion receipt is stable.
- **Given** a legal hold or an immutable delivered report, **when** deletion is requested, **then** the approved exception is recorded and communicated without claiming those records were erased.

## Product decisions still needed

Employee-rights implementation is deferred while there are no real employees in the product. If this work resumes, the requester channel is decided: signed Slack DM for active linked employees, manual verification for former employees. The export delivery mechanism and inventory, deletion exceptions, delivered-report treatment, and self-review scope still need decisions. Use the existing typed tenant policy for retention; do not duplicate durations in the rights workflow. Keep the unsafe legacy routes unmounted in the meantime.
