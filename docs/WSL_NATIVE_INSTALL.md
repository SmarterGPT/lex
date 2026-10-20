# WSL Native Lex Installation

Install and run Lex inside WSL when the agent or shell runs inside WSL. Do not let a Windows npm
shim or npm's disposable `_npx` cache win on `PATH`, and do not share native `node_modules` across
the Windows/WSL boundary.

## Packaged installation

Configure a user-owned npm prefix once if your WSL environment does not already have one:

```bash
npm config set prefix "$HOME/.local"
mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"
```

Persist that `PATH` entry in the WSL shell profile, then install the published package:

```bash
npm install --global @smartergpt/lex
hash -r
```

Confirm the selected executable is Linux-native and stable:

```bash
type -a lex
command -v lex
readlink -f "$(command -v lex)" || true
lex --version
```

The active command should resolve below the WSL npm prefix, not `/mnt/c/...` and not
`~/.npm/_npx/...`.

## Contributor installation from a checkout

Use this path only when you intentionally want `lex` to track a source checkout after each build:

```bash
cd /path/to/lex
npm ci
npm run build
npm run check-sqlite

mkdir -p "$HOME/.local/bin"
ln -sfn "$PWD/dist/shared/cli/lex.js" "$HOME/.local/bin/lex"
export PATH="$HOME/.local/bin:$PATH"
hash -r
```

Re-run `npm run build` after source changes. The symlink is stable because it targets the checkout,
not npm's `_npx` cache.

## Native module requirements

Lex 4.4.3 pins `better-sqlite3-multiple-ciphers` 13.0.3, which ships Node-API binaries
for Linux x64/arm64 (glibc or musl), Windows x64/arm64 and macOS x64/arm64. Lex requires
Node.js 24 or newer; the Linux glibc binaries require glibc 2.35 or newer. This upstream inventory
does not mean every combination has passed Lex release qualification.

Install dependencies independently in WSL and Windows. A normal packaged installation does not
require build tools, a download helper or a rebuild after switching supported Node versions.
To verify a contributor checkout with lifecycle scripts disabled:

```bash
npm ci --ignore-scripts
npm run check-sqlite
```

The old `npm run rebuild-sqlite` command now aliases the check. A failed or unsupported binary
stays a failed check; do not silently compile a replacement or copy Windows `node_modules` into WSL.

See [SQLite Native Bindings](./dev/sqlite-bindings.md) for detailed failure modes.

## Isolated validation

These commands confirm executable resolution and keep any compatibility-store initialization in a
temporary directory rather than the current repository:

```bash
lex --version
lex introspect --json
LEX_STORE=sqlite LEX_DB_PATH="$(mktemp -d)/memory.db" lex recall --list 1 --json
```

The last command is workspace-isolated, not filesystem read-only: opening the compatibility store
can create an empty temporary SQLite database.

If AXF is installed separately, optionally confirm it resolves the same WSL-native Lex:

```bash
axf --workspace /path/to/repository run global.lex.status --json
```

## Avoid

- Windows `lex.CMD`, `lex.ps1`, or other npm shims through `/mnt/c/...` paths
- symlinks into `~/.npm/_npx/...`
- shared `node_modules` between Windows and WSL
- `lex remember` merely to prove installation
- copying a live SQLite database between the two surfaces for shared access; use PostgreSQL for
  coordinated cross-host storage
