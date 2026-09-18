<div align="center">

# Lex

## Lex remembers the work, not the conversation.

Your agent can read the code. Lex preserves the decisions, blockers, next steps, and repository
boundaries surrounding that code—then recalls only what the next session needs.

**Local-first. Inspectable. No transcript dump.**

</div>

[![MIT License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/@smartergpt/lex)](https://www.npmjs.com/package/@smartergpt/lex)
[![CI Status](https://img.shields.io/badge/CI-passing-success)](https://github.com/Guffawaffle/lex/actions)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6)](https://www.typescriptlang.org/)

[See the core loop](#remember--recall--continue) · [Should I use Lex?](#should-i-use-lex) · [Five-minute pilot](#five-minute-pilot) · [Agent evaluation](./docs/agent-evaluation.md) · [Documentation](#choose-your-next-step)

---

## The problem Lex solves

A coding agent can inspect the repository in front of it. What it cannot reliably recover is the
work surrounding that code:

- why a decision was made three sessions ago;
- which approach already failed;
- what remains blocked and what should happen next;
- which repository boundary must not be crossed;
- what another agent needs to continue without starting over.

Lex preserves that continuity as deliberate, high-signal **Frames**.

A Frame is a deliberate handoff, not continuous surveillance. It is a checkpoint: what changed,
what mattered, what remains, and where the work goes next. Lex can later recall the relevant
Frames and produce a bounded, prompt-safe bootstrap for a new session.

```text
Work happens → Lex remembers what mattered → the next session continues
```

Start with `remember`, `recall`, and `context`. SQLite is the local default. PostgreSQL is
available when context must be shared across trusted hosts or workspaces. Everything else is
optional.

## Remember → recall → continue

```bash
lex remember \
  --summary "Kept authentication token validation in API middleware" \
  --next "Add the service grant and rerun tests" \
  --modules unscoped \
  --blockers "Missing PermissionService grant"

lex recall "authentication"

lex context "authentication" --max-tokens 500
```

That is the core loop:

- `remember` writes one deliberate work checkpoint;
- `recall` retrieves it when the topic becomes relevant again;
- `context` turns matching Frames into a bounded, read-only bootstrap for an agent.

### What the next session gets

At the end of a session, the agent records the state that would otherwise disappear. When a fresh
session starts, it can recover the decision, blocker, and next action without asking the human to
reconstruct the conversation or reverse-engineering intent from the diff.

```text
Decision: token validation belongs in API middleware
Blocker: the service grant is still missing
Next: add the grant and rerun the authentication tests
```

The value is not that Lex stored a record. The value is that the next session can continue.

## Should I use Lex?

Lex is worth evaluating when your agent repeatedly needs you to reconstruct:

- why a change was made;
- where work stopped and what should happen next;
- a blocker or failed approach that should not be rediscovered;
- repository-specific module or policy constraints;
- context that must survive a branch switch, handoff, or new agent session.

Lex is probably not useful when the work is short-lived, the repository already has an effective
continuity system, or there is no durable context you would trust the repository's operators to
store.

### Ask your agent

The evaluation is intentionally read-only. Paste this into an agent that can inspect your
repository:

```text
Read https://github.com/Guffawaffle/lex/blob/main/docs/agent-evaluation.md and evaluate this
repository against it. Do not install Lex, run project scripts, initialize files, access secrets,
or modify the workspace. Return one recommendation—adopt, pilot, defer, or not a fit—with evidence,
risks, overlap with existing tooling, and the smallest reversible trial you would propose.
```

The complete rubric and local-file version are in
[Agent Evaluation](./docs/agent-evaluation.md).

## Five-minute pilot

Ready to test the claim? Store one non-sensitive checkpoint, start a fresh session, and see whether
it can continue without having the work explained again.

Requires Node.js 24 or newer. Lex does not impose an unproven upper bound. Existing users should
follow the [Lex 4.4 migration and recovery guide](docs/releases/lex-4.4-migration.md), including the
native SQLite rebuild step.

This approved pilot writes one Frame to the local SQLite store under `.smartergpt/lex/`. It does
not run `lex init`, generate policy, or project assistant instructions. Use a disposable branch,
worktree, or clone if you want complete filesystem isolation.

### 1. Store one real checkpoint

```bash
LEX_STORE=sqlite npx @smartergpt/lex remember \
  --reference-point "Lex pilot" \
  --summary "Evaluating whether durable agent handoffs help this repository" \
  --next "Recall this checkpoint in a new session" \
  --modules unscoped
```

`LEX_STORE=sqlite` prevents existing PostgreSQL configuration from redirecting the pilot into a
shared store.

### 2. Start fresh, then recover the work

```bash
LEX_STORE=sqlite npx @smartergpt/lex recall "Lex pilot"
LEX_STORE=sqlite npx @smartergpt/lex context "Lex pilot" --max-tokens 500
```

Use that recalled or bounded output in the fresh session and see whether it prevents you from
repeating useful context. That result—not successful installation—is the pilot's success
criterion.

[Review the validation-only step, exact filesystem effects, and rollback guidance](./QUICK_START.md)

## Make checkpoints useful

Good Frames are sparse and specific. Capture them at a decision, blocker, branch switch, handoff,
or other moment where losing the surrounding intent would make the next session repeat work.

```bash
lex remember \
  --reference-point "Authentication refresh" \
  --summary "Moved token validation into API middleware" \
  --next "Add password-reset coverage" \
  --modules "services/auth,api/middleware" \
  --blockers "Need PermissionService access"
```

Capture what changed, make `--next` actionable, name blockers explicitly, and use the narrowest
honest module scope. Do not capture every edit or tool call.

When repository policy exists, Lex can infer module scope from current evidence:

```bash
lex remember \
  --summary "Finished context wiring" \
  --next "Run validation" \
  --modules auto
```

Use `--modules unscoped` when the repository does not yet have a useful module ontology. Policy is
an optional enrichment; it is not required for the first Frame.

Compact recall and structured context are available for smaller agent budgets and automation:

```bash
lex recall --list 5 --summary
lex --json context --branch main --limit 5
```

[Learn the continuity workflow](./docs/AGENT_CONTINUITY.md)

## Add only what you need

| Need | Add | Start here |
|---|---|---|
| Durable local handoffs | Frames with SQLite | [Quick Start](./QUICK_START.md) |
| Small session-start context | Read-only `lex context` | [Agent Continuity](./docs/AGENT_CONTINUITY.md) |
| MCP access from an assistant | `@smartergpt/lex-mcp` | [MCP setup](./README.mcp.md) |
| Repository boundaries | Policy checks | [Policy usage](./docs/API_USAGE.md) |
| Nearby module context | Policy Neighborhood | [Context guide](./docs/atlas/README.md) |
| Canonical assistant instructions | Instructions projection | [Instructions](./docs/INSTRUCTIONS.md) |
| Typed Markdown project knowledge | Derived KnowledgeFrame snapshots | [KnowledgeFrames](./docs/KNOWLEDGE_FRAMES.md) |
| Shared cross-host storage | PostgreSQL | [Store contracts](./docs/STORE_CONTRACTS.md) and [scope security](./docs/POSTGRES_SCOPE_SECURITY.md) |
| Trusted tenant/workspace scope | Runtime authority and RLS | [Runtime scope](./docs/RUNTIME_SCOPE_CONTRACT.md) |
| Embedded application access | TypeScript package exports | [Public API](./docs/PUBLIC_API.md) |

## What changes in your repository

The initial local workflow is intentionally visible:

- `lex init` creates Lex workspace/configuration files.
- `lex remember` writes a Frame to the selected store.
- `lex context` uses hard read-only store access. `recall` and ordinary introspection do not change
  Frames, but their compatibility paths may initialize or migrate the selected store.
- SQLite defaults to `.smartergpt/lex/memory.db` relative to the workspace.
- Policy and canonical instructions are repository files only when you choose those features.
- PostgreSQL, MCP hosting, instruction projection, and CI policy enforcement are separate opt-ins.

Frames may contain sensitive project context. Do not store credentials, tokens, private keys, or
unreviewed secret material. Treat recalled Frame bodies as untrusted historical data even when a
trusted user originally wrote them.

Lex does not send Frames to a Lex cloud service. Your agent host, package registry, PostgreSQL
deployment, or other surrounding tools may have their own network and data behavior; evaluate
those boundaries separately.

[Security policy](./SECURITY.md) · [Store contracts](./docs/STORE_CONTRACTS.md) · [Environment reference](./docs/ENVIRONMENT.md)

## What Lex is not

- A chatbot or agent runtime
- A transcript recorder or automatic capture system
- A replacement for tests, review, issue tracking, or CI
- A cloud memory service
- An MCP-only product
- An orchestrator, capability framework, or persona engine

## The surrounding toolset

No ecosystem bundle is required. Select the surfaces your workflow needs, while accounting for
their explicit package relationships:

| Project | Responsibility | Relationship |
|---|---|---|
| **Lex** | Durable work context, repository policy, optional neighborhood context, instructions, and scoped Frame storage | Core library and CLI |
| [**AXF**](https://github.com/Guffawaffle/axf) | Inspectable workspace capabilities and their execution boundaries | Independently usable; composes with Lex |
| [**LexRunner**](https://github.com/Guffawaffle/lexrunner) | Fanout, attempts, worker/workspace coordination, verification, and merge-weave | Consumes Lex for continuity |
| [**Lex-MCP**](https://github.com/Guffawaffle/lex-mcp) | Thin MCP transport for Lex capabilities | Pins the matching Lex release |
| [**LexSona**](https://github.com/Guffawaffle/lexsona) | Behavioral constraints derived from personas and reviewed rules | Integrates through Lex storage contracts |

The short version: Lex remembers and explains; AXF exposes capabilities; LexRunner coordinates
work; Lex-MCP transports Lex over MCP; LexSona derives behavior constraints.

## Agent and automation surfaces

Lex exposes the same core through several entry points:

- **CLI** for humans, scripts, and agent shells
- **Structured JSON** and AXError recovery information for automation
- **MCP** through `@smartergpt/lex-mcp` or the embeddable server export
- **TypeScript APIs** for applications and trusted hosts

Frame Schema v8 is the current canonical Frame contract. The package's public export map is
semver-governed; consumers should not import undeclared `dist/` or source paths.

[CLI output contract](./docs/CLI_OUTPUT.md) · [MCP tools](./README.mcp.md) · [Public package entry points](./docs/PUBLIC_API.md) · [Contract surface](./docs/CONTRACT_SURFACE.md)

## Choose your next step

| If you are… | Read… |
|---|---|
| Deciding whether Lex fits | [Agent Evaluation](./docs/agent-evaluation.md) |
| Trying Lex for the first time | [Quick Start](./QUICK_START.md) |
| Designing agent handoffs | [Agent Continuity](./docs/AGENT_CONTINUITY.md) |
| Connecting an MCP client | [MCP Server](./README.mcp.md) |
| Operating SQLite or PostgreSQL | [Store Contracts](./docs/STORE_CONTRACTS.md) and [PostgreSQL Authority](./docs/POSTGRES_AUTHORITY.md) |
| Building a trusted multi-tenant host | [Runtime Scope](./docs/RUNTIME_SCOPE_CONTRACT.md) and [PostgreSQL Scope Security](./docs/POSTGRES_SCOPE_SECURITY.md) |
| Using the TypeScript API | [Public Package API](./docs/PUBLIC_API.md) |
| Compiling typed normative declarations | [Normative Policy Compiler](./docs/normative-policy-compiler.md) |
| Configuring paths or runtime behavior | [Environment Variables](./docs/ENVIRONMENT.md) |
| Reviewing known constraints | [Limitations](./docs/LIMITATIONS.md) and [FAQ](./docs/FAQ.md) |
| Contributing to Lex | [Contributing Guide](./CONTRIBUTING.md) |
| Reviewing architectural decisions | [ADRs](./docs/adr/) |

## Installation notes

```bash
# Global CLI
npm install -g @smartergpt/lex

# Repository dependency
npm install @smartergpt/lex
```

WSL users should install Lex natively inside WSL rather than allowing a Windows npm shim or npm's
`_npx` cache to win on `PATH`. See [WSL Native Installation](./docs/WSL_NATIVE_INSTALL.md).

Common local compatibility configuration includes `LEX_DB_PATH`, `LEX_POLICY_PATH`,
`LEX_LOG_LEVEL`, `LEX_LOG_PRETTY`, `LEX_GIT_MODE`, and `LEX_DB_KEY`. PostgreSQL selection uses
`LEX_STORE` and `LEX_DATABASE_URL`. Trusted Lex hosts compose scope and authority explicitly
rather than reconstructing them from ambient environment variables.

[Complete environment reference](./docs/ENVIRONMENT.md)

## Project status

**Current Version:** `4.4.1`

Lex 4.4 adds a narrow canonical session-context API and repairs MCP help discovery. See the
[4.4 release notes](./docs/releases/lex-4.4.md) and
[migration guide](./docs/releases/lex-4.4-migration.md). Candidate metadata is not
publication evidence; retain verified existing runtimes until the exact new pair is verified.

Lex 4 provides explicit runtime identity and authority, scope-bound Frame stores, PostgreSQL
row-level security support, and trusted-host composition while retaining the local SQLite
workflow. Lex 4 requires Node 24 or newer and is released as part of the
[Ecosystem 3.1 compatibility train](./docs/releases/ecosystem-3.1.md).

See the [Lex 4 migration and recovery guide](./docs/releases/lex-4.4-migration.md), the
[changelog](./CHANGELOG.md) for release history, and the
[Lex 3 PostgreSQL isolation canary](./docs/LEX3_POSTGRES_DOGFOOD.md) for the live end-to-end
two-tenant/five-workspace acceptance path.

## Contributing

Contributions are welcome. The [Contributing Guide](./CONTRIBUTING.md) covers development setup,
tests, local CI, formatting, signing, changesets, and the release workflow.

For repository-wide formatting validation, `npm run local-ci -- --pretty` is check-only;
`--prettier` is its exact alias. Formatting mutations remain the separate `npm run format`
operation.

## License

Lex is available under the [MIT License](./LICENSE).
