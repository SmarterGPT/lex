# Prior native-driver compatibility fixtures

These files contain synthetic Lex schema-v14 data, created with the actual prior locked and installed `better-sqlite3-multiple-ciphers@12.11.1` before upgrading to 13.0.3. They contain no user/project data or real credential. The manifest records the old npm integrity, engine/platform, exact source commit, file sizes and SHA-256 digests. Its passphrase is deliberately public test data.

`scripts/create-sqlite-v12-fixtures.mjs` creates both files using that old installed dependency and Lex's actual `createDatabase` / `saveFrame` code. It refuses another version or overwriting existing fixtures. The encrypted fixture uses Lex's explicit SQLCipher PRAGMAs and existing PBKDF2 key derivation. There is no cipher/default or key migration in this change.

Ordinary tests open originals read-only, assert data/FTS/integrity and unchanged file bytes/sidecars, then modify disposable copies through the new driver and Lex API. The additional `scripts/verify-sqlite-upgrade.mjs --prior-module <retained-old-package-directory>` qualification checks old-reader reopen after new-driver writes and the reverse direction using an explicitly retained, installed old binary. Retained old modules are local verification artifacts, not distributed dependencies or install fallbacks. No live store is consulted.
