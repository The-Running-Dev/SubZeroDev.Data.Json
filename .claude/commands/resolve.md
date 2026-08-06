---
description: Triage a pull request's review comments, fix what is valid, and resolve the threads that fix satisfies
argument-hint: [pr number]
---

Work the review comments on pull request **$1** — the current branch's PR if no number is given.

**Resolving a thread is an external write, and it is not covered by the issue carve-out** (`AGENTS.md`, *Tracking work* — that covers opening issues, not commenting on or resolving anyone else's thread). Read this repository's own instruction file first: some delegate resolution after a validated fix so a thread cannot block auto-merge, some forbid replying or resolving without authorization. **Follow what it says. Where it is silent, ask before resolving anything** — subject to the batch below, which still asks once, just not once per action.

## Find every thread

`gh pr view --json reviewRequests,latestReviews` **does not show conversation threads.** An automated reviewer can leave threads that block merge and appear nowhere in that listing — this has cost real time, and it is why the query is written out here:

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner:"OWNER", name:"REPO") {
    pullRequest(number:N) {
      reviewThreads(first:100, after:$endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line
          comments(first:10) { pageInfo { hasNextPage endCursor } nodes { author { login } body } }
        }
      }
    }
  }
}'
```

`--paginate` walks `reviewThreads`' own `pageInfo` to exhaustion — a PR with more than 100 threads is not silently truncated. Each thread's nested `comments` connection paginates separately and `--paginate` does not reach it: if a thread's `comments.pageInfo.hasNextPage` comes back `true`, its first 10 comments are not the whole conversation, and it needs its own follow-up query, looped on that thread's `comments.pageInfo.endCursor` until `hasNextPage` is `false`, before it can be classified:

```bash
gh api graphql -f query='
query($threadId: ID!, $commentsCursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first:100, after:$commentsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { author { login } body }
      }
    }
  }
}' -f threadId="PRRT_…"
```

**Classifying from a partial fetch — a truncated thread list or a truncated comment list — is exactly the failure this pagination exists to prevent.**

Count unresolved threads before you start and say the number. If `required_review_thread_resolution` is on, that count *is* the merge blocker.

## Classify every thread

Produce one scannable table — every thread, one row, its `PRRT_…` node id included. **Volume from a bot is not authority**; classify on the merit of the claim, not on who filed it or how confidently it is worded. **Finish classifying every thread before acting on any of them** — the batch below asks once, over the full table, and a partial classification would mean asking again once the rest comes in.

| Class | Meaning | Action |
|---|---|---|
| **Defect** | The claim is correct and in scope for this PR | Fix it |
| **Out of scope** | Correct, but not this PR's job | **File an issue, reply with the link.** Do not widen the change — *one slice at a time* |
| **Not sustained** | The claim is wrong, or the code is right for a reason the reviewer could not see | Reply explaining why. Do not change code to silence a reviewer |
| **Already decided** | Contradicts a recorded decision | Reply, link the decision-log entry or ADR. Do not relitigate |
| **Ambiguous** | Two readings are both defensible | **Bring to me individually.** Do not guess |

Act on the four clear classes without further prompting. **Bring only the ambiguous ones for sign-off, one at a time** — that is proportionate: a twenty-comment automated review must not become twenty round trips, but nothing debatable gets resolved on your judgement alone.

## Order of operations

This sequence is the safeguard. Do not reorder it.

1. **Fix** the defects. Nothing else — no adjacent tidying, no refactors. Fixing code is not itself an external write, so this does not wait on the batch.
2. **Request the batch.** Now that classification is complete, ask once: name every `PRRT_` id you intend to resolve — the `Defect`-class threads the fix above addresses — and state that the single yes covers pushing, updating the pull request, and resolving exactly those ids (`AGENTS.md`, *Git and delivery* — the resolution batch, **I3**, **I4**). In a repository I do not own, the batch is unavailable (**I9**): ask for push, PR update, and each resolution individually instead, per that same section.
3. **Push.** A fix that is not pushed does not exist as far as the reviewer or CI is concerned.
4. **Confirm the checks are green on the new head SHA — not the old one — by calling `pwsh -File tools/Wait-PullRequestCheck.ps1 -PullRequest $1 -HeadSha <pushed SHA>`.** Resolution proceeds only when its `WaitResult.State` is `Passed`. Any other state — `Failed`, or `NotEvaluated` for any reason including `HeadMoved` or `NoChecksConfigured` — means stop and report; do not resolve anything.
5. **Re-query the threads** (§ Find every thread, fully paginated again) before resolving anything. **Only then resolve**, and only the ids named in the granted batch. A thread that appears in this re-query but was not in the batch — including a fresh bot review posted while the wait was running — is not covered by the earlier yes and needs its own ask, per the batch's own limit (**I4**).

**Never resolve a thread you did not address.** Resolving is how a blocking finding becomes invisible — it is the one action here that cannot be noticed afterwards. Leave anything ambiguous, contested, or merely replied-to **open**, and say so in your report.

Where the repository requires authorization to resolve: fix and push, then report which threads are now satisfied, and stop.

## Report

- Threads found, and how many were unresolved at the start
- The classification table
- What was fixed, and the pushed SHA
- The `WaitResult` for that SHA — including anything in `.NotRun`, per `/verify`
- The batch requested, and what it was granted to cover
- Threads resolved, and threads deliberately left open with the reason
- Issues filed for out-of-scope findings, with numbers

**Then ask.** Anything left open is unresolved work, and *a reconciliation ends in a decision, not a report* (`AGENTS.md`, *Working with me*). If every thread was clear-cut and nothing remains, say so and stop — do not manufacture a question.

## Never

- Change code purely to make a reviewer stop objecting. If the claim is wrong, say so.
- Resolve a thread on someone else's PR without being asked.
- Merge. That is `/pr`'s territory and this repository's convention, not this command's.
- Treat an outdated thread as resolved. `isOutdated` means the line moved, not that the point was answered.
- Resolve a thread that was not named in the granted batch, even if it looks like a clear win. It needs its own ask.
