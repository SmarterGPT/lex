# Lex Troubleshooting Guide

> **Status: Historical contributor snapshot.** This file contains pre-Lex-4 package paths and
> checkout-only commands. Do not use it as current consumer guidance. Start with
> [`README.md`](./README.md), [`docs/FAQ.md`](./docs/FAQ.md), the
> [public API](./docs/PUBLIC_API.md), and the
> [Lex 4 migration guide](./docs/releases/lex-4.0-migration.md). Maintainers may preserve this file
> as evidence while its remaining unique diagnostics are moved to current owners.

This guide helps you diagnose and fix common issues with Lex.

---

## ✅ Single-Package Structure (2025-11-06)

**Status:** Repository consolidated to single package (PR #91)

**Current Structure:**
- Single root `package.json`
- All source in `src/` directory
- Relative imports (no `lex/*` package names)
- Single build command: `npm run build`
- Subpath exports for external consumers

**Key Changes from Monorepo:**
- No more cross-package `dist/` imports
- No manual build orchestration
- TypeScript project references simplified
- All dependencies in single package.json

---

## Common Build Issues

## Common Build Issues

### Build Fails with "Cannot find module"

**Problem:**
TypeScript cannot find imported modules.

**Solution:**
1. Ensure dependencies are installed: `npm ci`
2. Clean and rebuild: `npm run clean && npm run build`
3. Check that imports use relative paths from `src/`:
   ```typescript
   // ✅ Correct
   import { Frame } from "../../shared/types/frame.js";

   // ❌ Wrong (old monorepo style)
   import { Frame } from "lex/types";
   ```

### Build Succeeds but Tests Fail

**Problem:**
Tests can't find compiled output or types.

**Solution:**
1. Build first: `npm run build`
2. Run tests: `npm test`
3. Check that test files use correct relative imports

---

## Historical Issues (Fixed in Single-Package Migration)

The following issues existed in the old monorepo structure and have been resolved:

### 1. Build Order Dependency Violation (RESOLVED)

**Old Problem (Monorepo):**
The monorepo build order violated dependency chains. `module_ids` depended on `aliases`, but `aliases` was built after `module_ids`.

**Solution (Single Package):**
TypeScript project references now handle build order automatically with `tsc -b`.

---


### 2. Cross-Package Import Issues (RESOLVED)

**Old Problem (Monorepo):**
Cross-package imports using `lex/*` aliases and `/dist/` paths were fragile.

**Solution (Single Package):**
All code now uses relative imports from `src/`. No package aliases needed.

---

## Testing Issues

### Tests Can't Find Modules

**Problem:**
Tests fail with module not found errors.

**Solution:**
Run tests with the correct command:
```bash
npm test                    # Unit tests
npm run test:integration    # Integration tests
npm run test:all           # All tests
```

### Native Dependencies Fail

For current Lex 4.4.3 guidance, use [SQLite Native Bindings](docs/dev/sqlite-bindings.md).
The exact SQLite 13.0.3 dependency ships Node-API binaries, so the old automatic rebuild advice
no longer applies. Verify Node.js 24 or newer and the supported platform/C library, then run:

```bash
npm ci --ignore-scripts
npm run check-sqlite
```

`npm run rebuild-sqlite` is now a compatibility alias for that health check. It does not compile
a module. Preserve a failed check and its package identity; do not silently add a source-build or
download fallback. The health check uses disposable databases and does not repair a live store.

---

## Aliasing and Module ID Issues

### Ambiguous Substring Error

**Problem:**
A substring matches multiple module IDs and the system cannot determine which one you meant.

**Example Error:**
```
Ambiguous substring 'user' matches:
  - services/user-access-api
  - services/user-profile-service
  - ui/user-admin-panel
```

**Solution:**
1. Use a more specific substring: `lex remember --modules user-access`
2. Use the full module ID: `lex remember --modules services/user-access-api`
3. Add an alias in `src/shared/aliases/aliases.json`
4. Disable substring matching for strict mode: `lex remember --modules user --no-substring`

### Module Not Found with Typo

**Problem:**
You mistyped a module ID and the system suggests similar matches.

**Example Error:**
```
Module 'servcies/auth-core' not found in policy. Did you mean 'services/auth-core'?
```

**Solution:**
1. Use the suggested correction
2. Check available modules: `cat .smartergpt/lex/lexmap.policy.json | jq '.modules | keys'`
3. Add an alias to avoid future typos

### Missing Module ID

**Problem:**
The module ID doesn't exist in the policy.

**Example Error:**
```
Module 'payment-gateway' not found in policy.
```

**Solution:**
1. Verify the module exists in `lexmap.policy.json`
2. Add the module to the policy if it should exist
3. Use the correct module ID from the policy
4. Create an alias once you find the correct name

---

## Runtime Issues

### CLI Command Not Found

**Problem:**
`lex` command doesn't work after installation.

**Solution:**
1. Build the project: `npm run build`
2. Link locally for development: `npm link`
3. Or run directly: `node dist/shared/cli/lex.js`

### Policy File Not Found

**Problem:**
`lex check` can't find the policy file.

**Solution:**
Run the setup script to initialize working files:
```bash
npm run setup-local
```

This creates `.smartergpt/lex/lexmap.policy.json` from the example template.

**Alternative:**
Specify a custom policy path:
```bash
lex check --policy /path/to/custom-policy.json
```

Or use environment variable:
```bash
LEX_POLICY_PATH=/path/to/custom-policy.json lex check
```

---

## SQL Safety Violations

### Test Failure: "db.prepare() outside curated SQL modules"

**Problem:**
The SQL safety test fails because you've used `db.prepare()` in a file that isn't a curated query module.

**Example Error:**
```
Found db.prepare() calls outside curated SQL modules:

src/memory/mcp_server/routes/analytics.ts:45:  const stmt = db.prepare("SELECT COUNT(*) FROM frames");

All SQL must live in curated modules:
  - src/memory/store/queries.ts
  - src/memory/store/code-unit-queries.ts
  - src/memory/store/receipt-queries.ts
  ...
```

**Why This Rule Exists:**

Lex enforces a **curated query module** pattern to prevent SQL injection vulnerabilities and ensure all SQL is reviewed and maintained in one place. All `db.prepare()` calls must live in dedicated query modules, not scattered throughout the codebase.

**Benefits:**
- ✅ Easier security audits (all SQL in known locations)
- ✅ Prevents accidental SQL injection
- ✅ Single source of truth for database operations
- ✅ Better type safety with parameterized queries

### Sanctioned Query Modules

These modules are **allowed** to use `db.prepare()`:

| Module | Purpose |
|--------|---------|
| `src/memory/store/queries.ts` | Frame CRUD operations |
| `src/memory/store/code-unit-queries.ts` | CodeUnit CRUD operations |
| `src/memory/store/receipt-queries.ts` | Receipt CRUD and aggregation |
| `src/memory/store/lexsona-queries.ts` | LexSona behavioral queries |
| `src/memory/store/code-atlas-runs.ts` | CodeAtlas run tracking |
| `src/memory/store/images.ts` | Image storage queries |
| `src/memory/store/db.ts` | Schema initialization |
| `src/memory/store/backup.ts` | Backup utilities |
| `src/memory/store/sqlite/*` | SqliteFrameStore implementations |
| `src/memory/mcp_server/auth/state-storage.ts` | OAuth state storage |
| `src/memory/mcp_server/routes/*.ts` | MCP route handlers (minimal SQL only) |
| `src/shared/cli/db.ts` | CLI database utilities |
| `src/shared/runtime-scope/registry-queries.ts` | Surface-local binding registry schema and lifecycle queries |

### How to Fix: Move SQL to Curated Module

**❌ BEFORE (Violation):**

```typescript
// src/memory/mcp_server/routes/analytics.ts
export function getFrameCount(db: Database.Database): number {
  // ❌ Direct db.prepare() call in route handler
  const stmt = db.prepare("SELECT COUNT(*) as count FROM frames");
  const result = stmt.get() as { count: number };
  return result.count;
}

// Later in route:
app.get("/api/analytics", (req, res) => {
  const count = getFrameCount(db);
  res.json({ frameCount: count });
});
```

**✅ AFTER (Fixed):**

```typescript
// Step 1: Add query to curated module
// src/memory/store/queries.ts

/**
 * Get total count of frames in database
 */
export function getFrameCount(db: Database.Database): number {
  // ✅ SQL lives in curated module
  const stmt = db.prepare("SELECT COUNT(*) as count FROM frames");
  const result = stmt.get() as { count: number };
  return result.count;
}
```

```typescript
// Step 2: Import and use the curated query
// src/memory/mcp_server/routes/analytics.ts
import { getFrameCount } from "../../store/queries.js";

// ✅ Route calls curated query function
app.get("/api/analytics", (req, res) => {
  const count = getFrameCount(db);
  res.json({ frameCount: count });
});
```

### Common Patterns

#### Pattern 1: Simple SELECT Query

**❌ WRONG:**
```typescript
// In a route or service file
const frames = db.prepare("SELECT * FROM frames WHERE branch = ?").all(branch);
```

**✅ CORRECT:**
```typescript
// In src/memory/store/queries.ts
export function getFramesByBranch(db: Database.Database, branch: string): Frame[] {
  const stmt = db.prepare("SELECT * FROM frames WHERE branch = ?");
  const rows = stmt.all(branch) as FrameRow[];
  return rows.map(rowToFrame);
}

// In your route/service
import { getFramesByBranch } from "../../store/queries.js";
const frames = getFramesByBranch(db, branch);
```

#### Pattern 2: Aggregation Query

**❌ WRONG:**
```typescript
// In analytics service
const stats = db.prepare(`
  SELECT branch, COUNT(*) as count 
  FROM frames 
  GROUP BY branch
`).all();
```

**✅ CORRECT:**
```typescript
// In src/memory/store/queries.ts
export interface BranchStats {
  branch: string;
  count: number;
}

export function getFrameCountByBranch(db: Database.Database): BranchStats[] {
  const stmt = db.prepare(`
    SELECT branch, COUNT(*) as count 
    FROM frames 
    GROUP BY branch
  `);
  return stmt.all() as BranchStats[];
}

// In your service
import { getFrameCountByBranch } from "../../store/queries.js";
const stats = getFrameCountByBranch(db);
```

#### Pattern 3: Complex Query with Multiple Parameters

**❌ WRONG:**
```typescript
// In search service
const results = db.prepare(`
  SELECT * FROM frames 
  WHERE branch = ? 
    AND timestamp > ? 
    AND module_scope LIKE ?
  ORDER BY timestamp DESC 
  LIMIT ?
`).all(branch, since, `%${module}%`, limit);
```

**✅ CORRECT:**
```typescript
// In src/memory/store/queries.ts
export interface FrameSearchOptions {
  branch?: string;
  since?: string;
  moduleScope?: string;
  limit?: number;
}

export function searchFrames(
  db: Database.Database, 
  options: FrameSearchOptions
): Frame[] {
  const { branch, since, moduleScope, limit = 100 } = options;
  
  let query = "SELECT * FROM frames WHERE 1=1";
  const params: unknown[] = [];
  
  if (branch) {
    query += " AND branch = ?";
    params.push(branch);
  }
  
  if (since) {
    query += " AND timestamp > ?";
    params.push(since);
  }
  
  if (moduleScope) {
    query += " AND module_scope LIKE ?";
    params.push(`%${moduleScope}%`);
  }
  
  query += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);
  
  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as FrameRow[];
  return rows.map(rowToFrame);
}

// In your service
import { searchFrames } from "../../store/queries.js";
const results = searchFrames(db, { branch, since, moduleScope: module, limit });
```

### Remediation Steps

When the SQL safety test fails:

1. **Identify the violation:**
   - The test output shows the file and line number
   - Example: `src/memory/mcp_server/routes/analytics.ts:45`

2. **Choose the appropriate curated module:**
   - Frame queries → `src/memory/store/queries.ts`
   - Receipt queries → `src/memory/store/receipt-queries.ts`
   - CodeUnit queries → `src/memory/store/code-unit-queries.ts`
   - New domain → Consider if you need a new curated module

3. **Create a helper function in the curated module:**
   ```typescript
   export function yourQueryFunction(db: Database.Database, params: YourParams): YourResult {
     const stmt = db.prepare("YOUR SQL HERE");
     return stmt.all(params) as YourResult[];
   }
   ```

4. **Replace the inline SQL with the helper:**
   ```typescript
   import { yourQueryFunction } from "../../store/queries.js";
   const result = yourQueryFunction(db, params);
   ```

5. **Run the test to verify:**
   ```bash
   npm test -- test/sql-safety.test.ts
   ```

### Creating a New Curated Module

If your SQL doesn't fit into existing modules, you can create a new one:

1. **Create the module:**
   ```typescript
   // src/memory/store/your-domain-queries.ts
   import Database from "better-sqlite3-multiple-ciphers";
   
   export function yourQuery(db: Database.Database): YourResult[] {
     const stmt = db.prepare("SELECT ...");
     return stmt.all() as YourResult[];
   }
   ```

2. **Add to allowed patterns:**
   ```typescript
   // test/sql-safety.test.ts
   const ALLOWED_PATTERNS = [
     // ... existing patterns
     "memory/store/your-domain-queries.ts",
   ];
   ```

3. **Update this documentation** to list the new module.

### Security Best Practices

**DO:**
- ✅ Use parameterized queries with `?` placeholders
- ✅ Export typed functions with clear signatures
- ✅ Validate input before passing to SQL
- ✅ Use `unknown[]` or specific types for params
- ✅ Document what each query does

**DON'T:**
- ❌ String interpolation: `` `SELECT * FROM ${table}` ``
- ❌ Direct user input: `db.prepare(userInput)`
- ❌ Inline SQL in routes/services/utilities
- ❌ Dynamic table names without validation
- ❌ Untyped return values

**Example of UNSAFE pattern (never do this):**
```typescript
// ❌ EXTREMELY DANGEROUS - SQL INJECTION VULNERABILITY
function searchByColumn(db: Database.Database, column: string, value: string) {
  const query = `SELECT * FROM frames WHERE ${column} = '${value}'`;
  return db.prepare(query).all();
}
```

**Safe alternative:**
```typescript
// ✅ SAFE - Parameterized with validated column
function searchByColumn(
  db: Database.Database, 
  column: 'branch' | 'jira' | 'reference_point',  // Explicit whitelist
  value: string
): Frame[] {
  const query = `SELECT * FROM frames WHERE ${column} = ?`;
  const stmt = db.prepare(query);
  const rows = stmt.all(value) as FrameRow[];
  return rows.map(rowToFrame);
}
```

### Related Files

- **Test:** `test/sql-safety.test.ts` - Enforces the curated module pattern
- **Example Module:** `src/memory/store/queries.ts` - Frame queries
- **Example Module:** `src/memory/store/receipt-queries.ts` - Receipt queries

---

## Import Pattern Reference

### Correct Import Patterns (Single Package)

```typescript
// Types
import type { Frame } from "../../shared/types/frame.js";
import type { Policy } from "../../shared/types/policy.js";

// Functions
import { validateModuleIds } from "../../shared/module_ids/validation.js";
import { resolveModuleId } from "../../shared/aliases/resolver.js";
import { loadPolicy } from "../../shared/policy/loader.js";

// Store
import { FrameStore } from "../../memory/store/framestore.js";
```

### Old Import Patterns (DO NOT USE)

```typescript
// ❌ These were for the old monorepo structure
import { Frame } from "lex/types";
import { validateModuleIds } from "lex/module-ids";
import { resolveModuleId } from "lex/aliases/resolver";
```

---

## For External Consumers

If you're using Lex as a dependency, use the subpath exports:

```typescript
// Main entry
import { something } from "lex";

// CLI tools
import { cli } from "lex/cli";

// Policy utilities
import { checker } from "lex/policy/check";

// Memory utilities
import { FrameStore } from "lex/memory/store";

// Shared utilities
import { types } from "lex/shared/types";
```

---

## Questions?

If you're still having issues:

1. Check [FAQ](./docs/FAQ.md) for common questions
2. Open an issue on GitHub with:
   - Your Node.js version (`node --version`)
   - Your npm version (`npm --version`)
   - Full error output
   - Steps to reproduce

---

## References

- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Package.json Subpath Exports](https://nodejs.org/api/packages.html#subpath-exports)
