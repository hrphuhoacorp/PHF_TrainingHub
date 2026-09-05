# PHF HR — Chương trình thi đua · V1 frontend data contracts (Batch A)

Status: **contract draft for Batch B/C**. No backend exists yet. Batch A renders
only honest empty/not-connected states — nothing in this file is fetched today.

## Architecture recap (LOCKED)

- Business datastore: **Company PostgreSQL `phf_hr`**, schema `competition.*`.
- People/account master: **existing Supabase People Master** (`user_accounts`,
  `employee_profiles`). Competition **never** creates users.
- Identity flow (same as PHF Task): Supabase People Master → **Vercel resolves a
  verified actor** (`account_id` + `employee_code`, requires `user_accounts.status='active'`
  AND `employee_profiles.employment_status='active'`) → service-token bridge →
  `phf-hr-api` → Company PostgreSQL.
- **`phf-hr-api` MUST NOT query Supabase for Competition identity.** It receives a
  trusted `actor` object and, for display lists (e.g. reviewer candidate pickers),
  the Vercel layer supplies the resolved people rows.

## Envelope

All reads return `{ ok: true, ...payload }`; errors `{ ok:false, code, message }`.
Actions dispatched by `action` on `POST /api/data` (Vercel), forwarded to
`phf-hr-api` custom-method routes under a `PHF_COMPETITION_*_BRIDGE_ENABLED` flag.

## Types

### CompetitionBootstrap
Module bootstrap for the current viewer.
```
{
  viewer: { account_id, employee_code, display_name, is_competition_admin: bool,
            reviewer_max_level: int | null },   // reviewer_max_level null = not a reviewer
  active_campaign: Campaign | null,
  my_requirement: EmployeeRequirementProgress | null,
  capabilities: { can_submit: bool, can_review: bool, can_admin: bool }
}
```

### Campaign
```
{
  id, code, title, description, instructions,
  status: 'draft' | 'accepting' | 'reviewing' | 'finalized',
  form_schema: FormField[],
  min_valid_per_member_per_month: int | null,
  submission_deadline: iso8601 | null,
  review_deadline: iso8601 | null,
  finalized_at: iso8601 | null,
  publication_state: 'internal' | 'published',
  levels_frozen: bool,                 // true once status left 'draft'
  created_by_employee_code, created_at, updated_at
}
```

### FormField (campaign.form_schema entry)
```
{ key, label, type: 'text' | 'textarea' | 'select', required: bool,
  options?: string[], help?: string, order: int }
```
First campaign seed: `customer_question` (textarea, required),
`answer` (textarea, required), `actual_result` (textarea, optional),
`context` (select, optional).

### ApprovalLevel
```
{ id, campaign_id, level_order: int, name: string, score: number }
```
Editable only while `campaign.status === 'draft'`. `UNIQUE(campaign_id, level_order)`.

### ReviewerGrant
```
{ id, campaign_id, level_order: int, account_id, employee_code,
  display_name, is_active: bool, granted_by, granted_at }
```
`UNIQUE(campaign_id, account_id)` — one max level per reviewer per campaign.
Inheritance: a reviewer at `level_order = N` may act on any target level `<= N`.

### CompetitionAdminGrant
```
{ id, account_id, employee_code, display_name, is_active: bool,
  granted_by, granted_at, reason }
```
System `role==='admin'` is implicitly a Competition Admin (no row required).

### Submission (participant / owner view)
```
{
  id, campaign_id,
  status: 'draft'|'submitted'|'needs_revision'|'approved'|'rejected'|'finalized',
  payload: { [formFieldKey]: string },
  current_level_order: int | null,
  current_score: number | null,
  last_review_note: string | null,       // reason shown to author on needs_revision/rejected
  submitted_at: iso8601 | null,          // campaign membership is by this time, NOT approval time
  created_at, updated_at
}
```

### AnonymousReviewerSubmission (reviewer queue — NO identity fields by construction)
```
{
  submission_ref: string,                // opaque; not the author, not the raw id
  campaign_id, campaign_title,
  payload: { [formFieldKey]: string },
  submitted_at: iso8601 | null,          // only if campaign config allows
  review_status: 'pending' | 'needs_revision' | 'approved',
  current_level_order: int | null,       // present if already approved at a lower level
  eligible_levels: ApprovalLevel[]        // levels this reviewer may act on (<= their max)
}
```
There is deliberately **no** author name / code / department / branch / avatar /
account field. `self_review` is blocked server-side (actor ≠ author by
`account_id` and `employee_code`).

### AdminSubmission (Competition Admin — full identity, always)
`Submission` plus:
```
{
  author: { account_id, employee_code, display_name,
            department_snapshot, branch_snapshot },
  history: SubmissionHistoryEntry[]
}
```

### SubmissionHistoryEntry / CampaignHistoryEntry (append-only)
```
{ id, action, actor_account_id, actor_employee_code, actor_display_name,
  before: object | null, after: object | null, reason: string | null, at: iso8601 }
```
Submission actions: create, edit, submit, revision_requested, revised, approve,
upgrade (`{from_level, to_level, from_score, to_score}`), reject, finalize,
admin_override. Campaign actions: create, edit, status_change, reopen, publish,
override.

### CompetitionRanking (Competition Admin, pre-publication; public only after finalize+publish)
```
{
  campaign_id, generated_at,
  rows: [ { rank: int, employee_code, display_name,   // display_name omitted in public view until published
            approved_count: int, total_score: number } ]
}
```
`total_score` uses each submission's **current** approved level score
(non-cumulative: `2 → 5` contributes 5, not 7).

### EmployeeRequirementProgress (future Checklist-facing read — NO cross-module write in V1)
```
{ campaign_id, period: 'YYYY-MM', employee_code,
  valid_count: int, required_count: int, missing_count: int }  // missing = max(0, required - valid)
```
Checklist consumes this later as an authoritative result; Competition never
writes to Checklist.

---

## V1.1 — NO-AI similarity suggestion + "Tôi cũng gặp" occurrence signal

**LOCKED**: a suggestion, never a verdict. No automatic rejection, no automatic
score change, no external request/embedding/paid AI. See
`services/phf-hr-api/lib/competition-similarity.js` (pure algorithm) and
`competition-similarity-service.js` (DB-facing shaping). Thresholds — single
source of truth, tuned against `scripts/test-competition-similarity-v1-1-2026-09.js`:
`HIGH >= 0.50`, `MEDIUM >= 0.28`, else `DIFFERENT`. Score = max(token Jaccard,
character-trigram Dice, diacritics-stripped token Jaccard) over normalized
Vietnamese text — MAX is deliberately recall-favouring (a false positive costs
one extra glance; a false negative hides a real duplicate).

Candidate pool: same `campaign_id` only, `status IN (submitted, needs_revision,
approved, finalized)` (never draft/rejected), newest 300 by `submitted_at`,
top 3 by relevance after scoring.

### SimilarityCheck (sender pre-submit, `competitionCheckSimilarity`)
```
{ hasSimilar: boolean,
  candidates: [ { submissionRef: uuid, questionExcerpt: string(≤160),
                  submittedAt: iso8601, submittedBeforeYou: true,
                  questionLabel: 'HIGH'|'MEDIUM'|'DIFFERENT', answerLabel: same } ] }
```
Never includes: candidate answer text, candidate author identity. A
participant's own other submissions are excluded from their own candidate pool.

### SimilarityReview (reviewer on-demand expand, `competitionGetSimilarForReview`)
```
{ candidates: [ { submissionRef: uuid, question: string, answer: string,
                  submittedAt: iso8601, relationship: 'before'|'after',
                  questionLabel, answerLabel, occurrenceCount: int } ] }
```
Reviewer sees full question+answer (matches the existing anonymous review
queue contract) but never author identity — consistent with V1's anonymous
review. `competition.review.queue` items additionally carry `hasSimilar` /
`similarCount` (boolean + count only, computed in-process from one shared
candidate fetch — no per-item DB round trip, no per-card endpoint spam).

### Occurrence (`competitionConfirmOccurrence`, `competitionGetOccurrenceCount`)
```
{ alreadyConfirmed: boolean, occurrenceCount: int }
```
Backed by `competition.submission_occurrences` (migration
`phf_hr_competition_v1_1_submission_occurrences.sql`) — one row per
(source_submission_id, account_id), never a `competition.submissions` row,
never affects score/leaderboard/awards. Distinct from `competition.reactions`
(heart = appreciation, different business meaning/owner). Author cannot
confirm an occurrence against their own submission.
