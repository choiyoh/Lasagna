English · [한국어](README.md)

# Lasagna

> The app used to be called Nopsidian. For compatibility the `.nopsidian/` folder inside a vault, the `@nopsidian/*`
> package names, the Drive sync folder (`Nopsidian/<vault>`), the `nopsidian-mcp` bundle name, and the app settings
> folder (userData) keep their old names.

A **personal local Markdown editor** that combines Notion's block editing and databases with Obsidian's wikilinks,
backlinks, and graph. Your notes stay as plain `.md` files on your own computer, and the app itself has no account and
no server. Google Drive sync is an opt-in module that only runs when you turn it on, and it requests a single
`drive.file` scope on your own Google account.

## What you get

- **Block editor** — headings, lists, checkboxes, tables, callouts, toggles, columns, code blocks, the slash (`/`)
  menu, block dragging, Markdown source mode (CodeMirror 6), find and replace.
- **Markdown source kept as-is** — opening and saving a note leaves the original text intact. 3-way merges and atomic
  saves keep outside edits and editor saves from overwriting each other.
- **Links** — `[[wikilinks]]`, aliases, heading/block links, embed autocomplete, links updated when a file is renamed,
  backlinks, tags and outline panels, graph view (sigma.js), quick switcher (⌘O), daily notes.
- **Databases** — a folder plus `_db.yaml` is the database. Table, board, list, gallery, calendar, and timeline views,
  filters, sorts, groups, relation/rollup/formula properties, calculated rows, CSV import and export.
- **Search** — SQLite FTS finds titles, body text, and tags, and the command palette (⌘P) jumps anywhere.
- **AI agents (MCP)** — an agent can read the vault while the app is closed and, if you allow it, write into the
  folders you pick and leave comments. [docs/mcp.en.md](docs/mcp.en.md)
- **Google Drive sync (opt-in)** — two-way sync between two machines, conflicts merged per note, deletions go to the
  trash. [docs/sync-setup.en.md](docs/sync-setup.en.md)
- Everything else — tabs and split panes, version history, trash, Notion ZIP import, HTML export, covers and emoji,
  templates.

## Repository layout

It is a pnpm monorepo. Core logic such as parsing, link resolution, and sync planning is plain TS in `packages/*` that
knows nothing about Electron, and it is verified with Vitest alone.

```
apps/desktop/            Electron (Forge + Vite) + React 19
  src/main/              lifecycle, windows and tabs, app:// and vault:// protocols, IPC, file write gate
  src/preload/           contextBridge — window.nops.{note,db,graph,search,vault,sync,app}
  src/workers/index/     IndexWorker — better-sqlite3, watcher, indexing, FTS
  src/workers/sync/      SyncWorker — Drive sync (the only place that uses the network)
  src/renderer/          UI — sidebar, editor, panels, database views, graph
  e2e/                   Playwright tests that launch the packaged app
packages/core/           remark extensions, md↔ProseMirror conversion, link resolution, DB, formula and path helpers
packages/editor/         editor extensions — callout, toggle, columns, wikilink, embed, formula, DB view nodes, source mode
packages/ipc-contract/   single definition of IPC channels and zod schemas
packages/sync-gdrive/    Drive sync engine (planning, merging) + DriveClient interface
packages/formula/        formula parser (Pratt) and evaluator
packages/mcp/            MCP server (stdio) — the way agents read and write the vault
fixtures/vaults/         sample vaults for round-trip golden tests
docs/                    PLAN.md (roadmap), adr/ (decision records), packaging, mcp and sync-setup guides
scripts/                 icon and build-artifact copying helpers
```

## Requirements

- **Node.js 22 or newer** (development and CI use 22; newer versions are fine locally)
- **pnpm 11.8.0** — run `corepack enable` once and it follows the `packageManager` field in `package.json`.

## Development

```bash
corepack enable
pnpm install

pnpm --filter @nopsidian/desktop start   # run the app (Electron + Vite)
pnpm lint                                # ESLint
pnpm typecheck                           # tsc for every package
pnpm test                                # Vitest for every package
pnpm format                              # Prettier
```

- On first launch a screen asks you to pick a vault folder. Pick any folder that contains `.md` files.
- To look around with a sample vault, open `fixtures/vaults/basic`.
- The e2e suite that runs against the packaged app is `pnpm --filter @nopsidian/desktop e2e` (package the app first,
  then Playwright runs it). For Linux (xvfb) instructions and platform-specific notes see
  [docs/packaging.md](docs/packaging.md).

## Building installers

`pnpm --filter @nopsidian/desktop make` — installers are built **on each OS itself** (native modules mean a Windows
installer cannot be built on a Mac). Details and signing/Gatekeeper notes are in [docs/packaging.md](docs/packaging.md).

## Connecting an AI agent

Run `pnpm --filter @nopsidian/mcp build` to produce `packages/mcp/dist/`, then copy the command or JSON shown in the
app's settings (⌘,) under **Connect an AI agent (MCP)** into Claude Code or Claude Desktop. Read tools always work;
write tools only work inside the folders you allow. Tool list and options: [docs/mcp.en.md](docs/mcp.en.md).

## Turning on Google Drive sync

Create an OAuth client in your own Google Cloud project, turn on the Drive API, then enter the client ID and client
secret under **Settings (⌘,) → Vault → ☁ Google Drive sync…**. The step-by-step guide is
[docs/sync-setup.en.md](docs/sync-setup.en.md).

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — staged roadmap and design
- [docs/adr/](docs/adr/) — decision records (sync, security boundaries, and more)
- [docs/formulas.md](docs/formulas.md) — formula syntax
- [docs/mcp.en.md](docs/mcp.en.md) · [docs/sync-setup.en.md](docs/sync-setup.en.md) · [docs/packaging.md](docs/packaging.md)
  (Korean originals: [docs/mcp.md](docs/mcp.md), [docs/sync-setup.md](docs/sync-setup.md))

## License

This is a private personal project. `private: true` in `package.json`, the app license is `UNLICENSED`, and only the
editor package (`packages/editor`) is MIT. Do not redistribute or sell the code in this repository.
