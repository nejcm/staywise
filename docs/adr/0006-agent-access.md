# 0006: Agent access through personal tokens and our own OAuth server

**Status:** accepted, 2026-10-22

## Context

Hosts want their own AI agent (Claude, ChatGPT, an IDE agent) to read and maintain their properties: guide sections, reservations, the inbox state. Staywise ships no agent of its own. The agent sees untrusted guest-adjacent text and writes text that guests read, so it is treated as a bearer of narrow delegated rights, never as the host.

Clients differ in what they can send. Claude Code, Cursor and VS Code take a static `Authorization` header. ChatGPT cannot. claude.ai and Claude Desktop take a header only in a limited beta, so for them OAuth is the general path ([Add unlisted](https://claude.com/docs/connectors/custom/add-unlisted), [Connector auth](https://claude.com/docs/connectors/building/authentication)).

## Decision

- **One remote MCP endpoint**, `POST /mcp`: `@modelcontextprotocol/server` v2, stateless, about 12 coarse tools. Tools are registered per granted scope. Every call runs under `app_runtime` with `withOwnerContext`; RLS is unchanged and no Supabase session or cookie is accepted at `/mcp`.
- **Two credential kinds, one principal** (`app.agent_grants`): owner, scopes (`read`, `content:write`, `reservations:write`, `inbox:write`), an optional single property, an expiry, and revocation.
  - **Personal tokens** (`sw_pat_…`) for header clients. They are shown once, stored as a SHA-256 digest, expire in at most 90 days and are revocable. Creation needs AAL2 when TOTP is enrolled or required (Q7) and sends an email.
  - **OAuth 2.1** for claude.ai and ChatGPT, served by a small authorization server of our own. It uses platform `crypto` and no library (Q20, Q30):
    - Discovery uses protected-resource metadata (RFC 9728) and authorization-server metadata.
    - Clients are client ID metadata documents only; there is no dynamic registration.
    - PKCE is S256 only.
    - `resource` is bound to `https://<host>/mcp` (RFC 8707), and `iss` is sent on authorization responses (RFC 9207).
    - Access tokens are opaque and last 1 hour. Refresh tokens last 30 days and rotate; reusing one revokes the whole grant. Codes last 60 seconds and work once. A grant ends 90 days after consent. All expiries are computed in SQL.
  - Lookups go through narrow `security definer` functions (`app.resolve_agent_token`, `app.resolve_agent_access_token`, `app.agent_grant_token_owner`) instead of widening RLS.
- **Client allowlist (Q26):** client IDs only under `https://claude.ai/` or `https://chatgpt.com/`. The fetch is HTTPS only, follows no redirects, has a 3 s timeout and reads at most 5 KB. The cache follows the document's headers, capped at 24 h. The document's `client_id` must equal its URL, and the redirect must match a listed one exactly, except that a loopback redirect on `localhost`, `127.0.0.1` or `[::1]` may use any port.
- **Consent (Q29):** `/oauth/authorize` sits behind the same session gate as token creation, and the gate runs before any client document is fetched. The page shows the client name, the redirect host in bold, a warning for loopback redirects, scope checkboxes, an optional property, and the resource. Approval re-checks the request on the server.
- **One live grant per (owner, client_id).** A new consent revokes the client's earlier grants, so a step-up never leaves old scopes alive. As a result, a host cannot hold two property-restricted grants for the same connector.
- **Out of scope:** an OAuth token gets a 403 `insufficient_scope` with `scope` and `resource_metadata`, so the client can step up. The 401 carries `scope="read"` and `resource_metadata`.
- **Kill switch and limits:** `AGENT_ACCESS_DISABLED` (default `true` outside `local`) turns off `/mcp`, `/oauth/*` and the metadata. The limits are Postgres windows: 60 requests per minute per token, 120 per host, 20 writes per token, and 20 failed authentications per IP. Each tool call is audited with metadata and an argument digest, never the arguments themselves.

### What the agent can never see or do

- **Guest message bodies and reply addresses.** The inbox gives metadata and mark-handled only (Q3).
- **Guest link secrets.** The host copies links from the UI; a created stay link returns no secret (Q4).
- **Destructive and account operations:** deleting properties, sections or reservations, link rotation, account or TOTP changes, and granting tokens (Q5).
- **Property credentials** (Wi-Fi name and password, key-box code, section secrets). It sees only whether each is set (Q13).
- **The alert email** (Q19). **`contactPhone`** is readable but write is UI-only, because it renders as `tel:` to guests.
- **Guest identity on reservations.** Batch upsert takes no guest names or contacts (Q6).

### Injection guard

Every agent write to guest-visible text (`update_property` name and address, `upsert_section`, `review_translation`) is refused if it adds a link, email, phone number or IBAN that the text did not already contain (Q21). Text is NFKC-folded first; zero-width characters are dropped; `(dot)` and `(at)` spellings fold; dotted quads count as links. Only plausible ISO dates and `HH:MM` times are blanked before counting phone digits. Section writes also keep a revision with one-click revert and an agent-edited marker.

Accepted residuals, all needing text a guest would have to reassemble:
- a capital or a one-sided space after a spaced dot (`evil . Example`, `evil .example`), or `evil dot example`;
- a phone whose first digits are written as a valid ISO date (`Call 2026-11-01 234 567`);
- phone-like strings of 8 digits or fewer;
- false-positive links on bare quads such as `1.2.3.4`.

The guard is a speed bump against laundering a scam contact into a guide, not a content filter; content writes carry a `requiresUserInteraction` hint and destructive annotations, which clients may or may not honour.

## Rejected

- **Supabase OAuth 2.1 server:**
  - Scopes are OIDC only (`openid email profile phone`), so there are no custom scopes.
  - It is built around dynamic registration and mentions no client metadata documents.
  - Its access tokens are project JWTs that "respect your existing RLS", so their audience is the whole project, not `/mcp`. A token we issue for an agent would also work against PostgREST, outside the `app_runtime` boundary.
  - Source: [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server); details in `plans/agent_access_security_research.md` (local only, not in git).
- **Better Auth (`mcp()` with `cimd()`):** it could replace both Supabase Auth and this server, but:
  - The MCP path requires the `jwt()` plugin, and JWT access tokens "cannot be revoked individually" ([mcp](https://www.better-auth.com/docs/plugins/mcp), [oauth-provider](https://www.better-auth.com/docs/plugins/oauth-provider)).
  - It has no AAL concept; magic link is "not gated by 2FA by default" ([2fa](https://www.better-auth.com/docs/plugins/2fa)).
  - It adds about 15 packages and 11 tables that are not RLS-aware, and the consent page would still be our code.
- **Clerk:**
  - It is a hosted identity store, so hosts' sessions and TOTP secrets would live with a third party.
  - MFA is not on the free plan ([pricing](https://clerk.com/pricing)).
  - Access tokens last a day and refresh tokens "never expire" ([how Clerk implements OAuth](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)). That conflicts with Q27.
  - RFC 8707 is not documented, and `@clerk/mcp-tools` targets MCP SDK v1.
  - Account deletion would span two systems (ADR 0002).
- **Why switching the auth provider buys nothing:** RLS does not depend on Supabase Auth. No policy uses `auth.uid()` or `auth.jwt()`; the owner boundary is `set_config('app.owner_id')`. Details: `plans/auth_and_login_log_research.md` (local only, not in git).
- **A REST API or a built-in agent (Q1):** more surface, and it duplicates what MCP clients already do.

## Accepted deviations from the plan

- A personal token calling a tool outside its scopes gets the SDK's JSON-RPC unknown-tool error, not `isError`, because the tool is not registered for it.
- Consent uses the token-creation gate. With `MFA_REQUIRED=false`, a host without TOTP consents at AAL1, exactly as they can create a personal token.
- The step-up 403 and the 401/429 denials write no audit row; no tool ran.
- A refresh with a narrower `scope` is answered with the grant's full scope and says so in `scope` (RFC 6749 §3.3).

## Consequences

- A client that retries a timed-out refresh replays a spent token and loses its grant; the host reconnects the app.
- A consent whose code is never redeemed leaves a grant with no tokens. It is hidden from settings and removed by retention cleanup.
- New clients beyond claude.ai and ChatGPT need a code change to the allowlist.
- Real-client behaviour (claude.ai, ChatGPT developer mode) is verified on staging during the pilot, not in CI.

Code: `src/features/agent/`, `src/routes/mcp.ts`, `src/routes/oauth.*`, `src/routes/[.]well-known.*`, `supabase/migrations/20261023090000_agent_grants.sql`, `20261024090000_agent_access_runtime.sql`, `20261025090000_agent_oauth.sql`, `supabase/tests/agent_*.sql`.
