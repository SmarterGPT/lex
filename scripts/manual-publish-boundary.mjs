#!/usr/bin/env node

console.error(`LEX_NPM_PUBLISH_REQUIRES_TRUSTED_WORKFLOW

Lex intentionally refuses to publish through "npm run release".

An agent may run:
  npm run release:dry-run

After the reviewed release commit is merged, an explicit publish: true dispatch of the protected
release.yml npm-release job builds, proves, and publishes the exact retained tarball. npm Trusted Publishing
is required. After Lex-MCP is public, the authenticated maintainer creates and pushes the
signed annotated v4.4.0 tag; that run verifies public integrity before creating the GitHub release.
No npm write token is accepted here.

See RELEASE.md and docs/releases/ecosystem-3.1.md. Nothing was published.`);

process.exit(1);
