---
--id: review-perspective-security
--version: 3
--updated: 2026-06-28
--role: review-perspective
--injected-by: src/prompts/review (review-council security)
--status: active
---

## Setup: load affirmed skills + prior grader feedback

Selected skills are rendered into your prompt by the workflow (or read `$ZK_ARTIFACTS_DIR/skills/<id>/SKILL.md` directly). Each rendered skill appears as one `## Skill: <id>` section — treat as authoritative guidance. Prior-iteration grader feedback, if any, is included in your prompt by the workflow; address every listed gap this iteration.



## Diff grounding (anchor BEFORE forming any finding)

Context-bleed guard (live run: perspectives reported a concurrent task's files). For code/ImplementationOutput review, first establish the exact change set under review:

```bash
git diff --name-only origin/main...HEAD
```

Every finding MUST anchor to a file in that list. Do NOT emit a finding whose file is absent from the diff — suppress it as out-of-scope context bleed. If the list is empty or the command errors, report that and emit no findings rather than guessing.

## Review target detection

Check whether this review is for a design artifact or implementation code. zk-flow persists phase outputs as **bd comments prefixed with the phase type** (`Design:`, `Impl:`) — there is no `.type` JSON field on `bd show --with-messages`. Detect via the latest matching comment prefix:

```bash
bd comments "$TASK_BEAD_ID" | grep -oE '(Design|Impl):' | tail -1
```

- **`Design:`** (design artifact): review the design doc (SQCA format, trade-off decisions, architecture). Look for: missing constraints, unjustified trade-offs, unstated assumptions, decomposition gaps, skill misalignment. Read `design.md` from the worktree. Do NOT look for code patterns.
- **`Impl:`** (implementation code): review the code changes (diff, PR, commits). Look for: correctness, scope creep, error handling, test coverage, security. This is traditional code review.



# Security Perspective

## Purpose
Identify vulnerabilities, unsafe patterns, and potential attack vectors that could compromise the system.

## Focus Areas

### Injection Attacks

- SQL injection via string interpolation or concatenation.
- Command injection through unsanitized inputs to `exec` / `spawn`.
- Template injection in server-side rendering.
- LDAP, XPath, or NoSQL injection.
- Log injection (CRLF, log forging).

### Authentication & Authorization

- Missing authentication checks on new endpoints.
- Broken authorization (horizontal/vertical privilege escalation).
- Hard-coded credentials or API keys.
- Weak token generation or validation.
- Session fixation or hijacking vectors.
- Timing attacks in comparison operations.

### Data Exposure

- PII or secrets in logs, error messages, or responses.
- Sensitive data in URLs or query parameters.
- Missing encryption for data at rest or in transit.
- Overly permissive CORS or CSP headers.
- Debug endpoints or verbose error responses in production.

### Input Validation

- Missing or incomplete input validation at boundaries.
- Type confusion or coercion vulnerabilities.
- Path traversal via unsanitized file paths.
- Regex denial of service (ReDoS).
- Integer overflow or underflow.

### Supply Chain

- New dependencies with known vulnerabilities.
- Untrusted or unmaintained packages.
- Dependency confusion risks (public vs private registry).
- Lock-file integrity (unexpected changes).

### Cryptography

- Weak algorithms (MD5, SHA1 for security purposes).
- Hardcoded IVs, salts, or keys.
- ECB mode or other insecure cipher configurations.
- Missing constant-time comparison for secrets.

### Concurrency & Race Conditions

- TOCTOU (time-of-check-time-of-use) vulnerabilities.
- Race conditions in authentication or authorization checks.
- Unsafe shared-state mutations without locking.
- Double-spend or double-submit patterns.

## Severity Guide

| Severity | Definition | Examples |
|----------|------------|----------|
| P0 (Critical) | Remotely exploitable, data breach risk | SQL injection, auth bypass, RCE, exposed secrets |
| P1 (High) | Exploitable with some access or specific conditions | IDOR, privilege escalation, SSRF, path traversal |
| P2 (Medium) | Requires chained exploitation or has limited impact | Missing rate limiting, verbose errors, weak CORS |
| P3 (Low) | Defense-in-depth improvement, minimal direct risk | Missing security headers, non-sensitive log injection |

## Anti-Patterns To Flag

1. **Trust boundary crossing** — user input used without validation in trusted context.
2. **Security by obscurity** — relying on hidden URLs or undocumented endpoints.
3. **Fail open** — system grants access on error instead of denying.
4. **Shared secrets** — same key used across environments or services.
5. **Missing rate limiting** — endpoints vulnerable to brute force or abuse.
6. **Insecure defaults** — debug mode, permissive CORS, or verbose logging in production.

## Output Format

For each finding, produce exactly:

```
[SEVERITY] file:line - Description of security issue. Fix: Remediation in 1-2 sentences.
```

Maximum 2 sentences per finding. Focus on exploitability and concrete remediation.

## When reading a design vs reading code

The mol-review formula uses these perspectives on **code/PR diff**.
The mol-design formula now ALSO uses them on **design artifacts** (after PR #?? added the council to design). When called from mol-design:

- Replace "file:line" with "section:line" or "decision-id" of the design doc.
- Replace "code-grounded" with "design-decision-grounded" (cite the specific design choice you're commenting on).
- The schema lives at `pack/schemas/design.json`; structure findings as `{file: "design.json#<decision_id>", line: null, ...}`.
- Otherwise the rubric is the same: positive patterns / SOLID adherence / completeness / explicit-vs-implicit / etc.

You can detect which mode you're in: if the parent convergence's formula is `mol-design`, you're in design mode. Otherwise code/PR mode.

