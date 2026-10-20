#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/ci-options.sh
source "$SCRIPT_DIR/ci-options.sh"
lex_ci_parse_options "$@"

echo "==> Local CI replica starting"
echo "pwd: $(pwd)"
node -v
npm -v

# Basic paranoia: ensure we don't accidentally have multiple package.json manifests after consolidation
EXTRA_MANIFESTS=$(find . -path ./node_modules -prune -o -name package.json -not -path ./package.json -print | wc -l | tr -d ' ')
if [[ -f package.json && "$EXTRA_MANIFESTS" -gt 0 ]]; then
  echo "NOTE: Multiple package.json files detected. Running in monorepo mode."
  MONOREPO=1
else
  MONOREPO=0
fi

# Hermetic install
export npm_config_fund=false
export npm_config_audit=false
echo "==> npm ci (ignore postinstall)"
npm ci --ignore-scripts

# Verify bundled Node-API binary without lifecycle scripts or a source-build fallback
echo "==> checking SQLite bindings health"
npm run check-sqlite

# Lint + type-check (non-blocking if scripts missing)
if npm run | rg -q '^  lint';   then echo "==> npm run lint"; npm run lint; fi
if npm run | rg -q '^  type-check'; then echo "==> npm run type-check"; npm run type-check; fi

# Check for orphaned TypeScript files (composite project validation)
echo "==> checking for orphaned TypeScript files"
./scripts/check-ts-orphans.sh

# Build + tests
# NOTE: Git tests are EXCLUDED from npm test and test:integration
# Git tests require interactive GPG signing and are run via npm run test:git only
if [[ "$MONOREPO" -eq 1 ]] && rg -q '"workspaces"' package.json; then
  echo "==> Monorepo mode: build & test all workspaces (if present)"
  npm -ws run build --if-present
  npm -ws run test --if-present
  if npm -ws run | rg -q '^  test:integration'; then
    npm -ws run test:integration --if-present
  fi
else
  echo "==> Single-package mode: build & test"
  if npm run | rg -q '^  build'; then npm run build; fi
  if npm run | rg -q '^  test:integration'; then npm run test:integration; fi
  if npm run | rg -q '^  test(:|$)'; then npm test; fi
fi

lex_ci_run_optional_audits
echo "==> Local CI replica completed OK"
