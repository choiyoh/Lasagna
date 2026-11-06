English · [한국어](mcp.md) · [README](../README.en.md)

# Connecting an AI agent (MCP)

This is a Model Context Protocol (MCP) server that lets an AI agent such as Claude **find and read** notes in a Lasagna
vault and, if you allow it, **write new notes**. It is a standalone stdio process that works while the app is closed; when
the app is open, notes an agent writes show up in the sidebar and in open editors right away.

## Connecting
1. In the app open **Settings (⌘,) → Connect an AI agent (MCP)**.
2. If you need it, turn on **Let agents write notes** and pick the folders they may write to (default `AI`). When it is
   off, agents are read-only. To allow the daily note too, turn on **Allow the daily note folder too**. If that is off,
   `append_to_daily_note` is denied with `forbidden-folder` because the daily folder is not in the allowed folders, and the
   settings screen shows that reason as well. In the English app the daily note folder is `Journal/` by default (or `일기/`
   when your vault already has one).
3. Pick a client tab (Claude Code / Claude Desktop / Codex / Cursor / VS Code / Gemini CLI) and **copy** the command or
   settings it shows into the right place.
4. The server name defaults to **`lasagna-<vault slug>-<vault id hash>`**. Two vaults registered with the same name
   still get different hashes and do not overwrite each other, and you can change the name yourself. If you rename it,
   register the entry again under the new name.

### Where each client keeps its settings

| Client | Where it goes | Format |
|---|---|---|
| **Claude Code** | Run once in a terminal | `claude mcp add -s user <name> -- <command> <args…>` (with `-s user` it is visible from Claude Code opened in any folder) |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`) | `mcpServers` JSON |
| **Codex** | `~/.codex/config.toml` | `[mcp_servers."<name>"]` TOML (`command`, `args`) |
| **Cursor** | `~/.cursor/mcp.json` (per project: `.cursor/mcp.json`) | `mcpServers` JSON |
| **VS Code** | `.vscode/mcp.json` (all workspaces: command palette → “MCP: Open User Configuration”) | `servers` JSON + `"type": "stdio"` |
| **Gemini CLI** | `~/.gemini/settings.json` | `mcpServers` JSON |

Some clients only show the server after a restart once the settings are saved. For Claude Code use `claude mcp list`,
for Codex use `codex mcp list`.

**Two vaults**: the settings on that screen (name, write folders, daily note allowance, selected client) are **stored per
vault**. If you open vaults A and B and make a snippet in each, the names differ (`lasagna-a-<hash>`,
`lasagna-b-<hash>`) and each snippet's `--vault` points at its own vault. If another vault setting in this vault uses the
same name, the app warns you before saving. The old global setting (`nops.mcp`) is **moved only into the first vault you
open**; new vaults start from read-only defaults.

If you registered the server under the old name `nopsidian`, run `claude mcp remove nopsidian` **from the folder where you
first registered it**, then register it again under the new name. Old snippets did not specify a scope, so they were
registered in the local scope, and adding `-s user` does not remove that registration. For other clients, delete the
entry from the settings file.

The settings shown by the packaged app **launch the app executable itself in `--mcp-stdio` mode** (for example
`"/Applications/Lasagna.app/Contents/MacOS/lasagna" --mcp-stdio --vault <vault folder>`). It runs the server bundle
inside the app (`resources/nopsidian-mcp.mjs`), so **Node.js does not have to be installed separately**. In a development
build (`pnpm start`) it shows settings that run the repository's `packages/mcp/dist/nopsidian-mcp.mjs` with `node`
(Node.js 22 or newer is required then).

Run it directly: `<app executable> --mcp-stdio --vault <vault folder> [--write] [--write-folder <folder>]…` (see
`--mcp-stdio --help`). During development you can still run `node nopsidian-mcp.mjs --vault <vault folder> …` as before
(`pnpm --filter @nopsidian/mcp build` creates `packages/mcp/dist/`, the same file as the app's
`resources/nopsidian-mcp.mjs`).

**Linux**: on a machine without a display (X/Wayland), such as SSH, a server, or an agent sandbox, Chromium exits
immediately with `Missing X server`, so on Linux the settings screen puts the headless switch first, like
`--ozone-platform=headless --mcp-stdio …` (this switch is decided before app code runs, so the app cannot add it itself).

**Windows**: the app executable is a windowless GUI program, so launching it from Explorer shows nothing because there is
no console. When an agent launches it with pipes (stdin/stdout) attached, it uses those pipes, so pasting the JSON or
command from the settings screen works. To try it by hand, run it with pipes from `cmd`, for example
`lasagna.exe --mcp-stdio --vault …`.

## Write permissions set by the app

The write toggle, the allowed folders, and the daily note checkbox on the settings screen are stored in the vault's
`.nopsidian/mcp-policy.json`. The MCP server re-reads the **intersection (whichever is more restrictive)** of the start
arguments (`--write`, `--write-folder`, `--max-writes-per-minute`) and this file on every write request. Without the
file it follows the arguments only, as before; if the file turns writing off or is broken, write tool calls are denied
with `policy-disabled`/`policy-invalid` and recorded as `denied` in the audit log. **Agents that are already connected**
are denied from their next write when you turn writing off in the app, and recover as soon as you turn it back on. An
agent connected without write tools has to be connected again. The policy file lives in `.nopsidian/`, which is not part
of Google Drive sync (connection settings differ per device), so **turning writing off on device A does not affect the
same vault on device B.** To block it on other devices too, turn writing off in the app on those devices or set their
agent connection to read-only.

## First-call cache

So the first tool call does not have to re-read the whole vault, `.nopsidian/mcp-cache.json` holds each note's
mtime, size, and ctime plus its parse result (title, aliases, tags, headings, links, properties, and a copy of the body
for search and snippets). If `.nopsidian/` is missing it is created, and even in read-only mode a cache file proportional
to the vault size appears (about 15 MB for 10,000 notes). On the next start only files whose **mtime, size, or ctime
changed** are read again, and a missing, broken, or differently versioned cache — or one with a different body limit — is
discarded and the whole vault is scanned. A cache larger than 256 MB is not read and the vault is scanned instead; such a
cache is not written again. Saves are deferred to about 2 seconds after the last change, away from tool response paths,
with one last attempt on a clean process exit. If a save fails, the next start still re-parses through the mtime, size,
and ctime check, so search results stay correct. Entries for notes deleted or moved to the trash are dropped from the
cache on the next refresh. The file contains note bodies, so it is written readable by the owner only (0600), is not part
of Google Drive sync, and is safe to delete. Saves go through a temporary file → fsync → rename, so even with more than
one server running a half-written JSON is never visible.

## Why the `RunAsNode` fuse stays off
Turning on Electron's `RunAsNode` fuse would let **any process call this app executable as a general-purpose Node.js
runtime** through `ELECTRON_RUN_AS_NODE=1`. A signed app binary with permissions would become an arbitrary-code path, so
it stays off and only a **dedicated `--mcp-stdio` MCP server mode** is open. In that mode the app creates no windows,
tray, protocol, or IPC (and hides the Dock icon on macOS), does not take the single-instance lock, and writes only MCP
JSON-RPC to stdout (logs and Chromium messages go to stderr).

## Tools
Read (always): `search_notes` (title, alias, tag, headings, and body AND search, with Korean substring matching),
`list_notes`, `read_note` (content plus hash, tags, headings, links, and properties; notes longer than 40,000 characters
are read in pages with `offset`/`limit` and return `total_chars`, `next_offset`, and `truncated`), `get_backlinks`,
`list_tags`, **`list_comments`** (comments left on a note — check them before editing), **`list_databases`** (database
folders with property types, select options, and views), **`query_database`** (rows by view, filter, and sort).
Write (only with `--write`): `create_note` (new note, fails if it exists), `append_to_note` (append at the end or at the
end of a heading section), `update_note` (replace wholesale — needs the hash from `read_note` and is refused if the note
changed in between; with a `partial:` hash from a partial read, a replacement shorter than the current note is refused so
truncated content cannot wipe the rest), **`edit_note`** (replace with `new_text` only when `old_text` occurs exactly once
in the current note; 0 or 2+ occurrences are refused with the match count; a `partial:` hash is accepted because
uniqueness is checked against the whole note; CRLF/LF and NFC/NFD forms are preserved), **`add_database_row`** (validate
property types and options, then add a row, assigning unique IDs and created automatically), **`update_database_row`**
(change only the given properties and leave the body alone; `null` clears one), **`add_comment`** (leave review feedback
without changing the note — this works on notes outside the write folders), `append_to_daily_note` (append to the daily
note for a date, creating it if needed — the folder comes from the daily folder in the app settings), `get_write_policy`.
`add_database_row` applies the database's default template (or the `template` argument). Database writes only work inside
the allowed folders (the database folder must be in `--write-folder`), and calculated properties, two-way relations,
unknown properties, and unknown options are refused with a reason.
There are no delete, move, or rename tools.

## Safety
- **Read-only by default.** Writing must be turned on with `--write`, and **anything outside the allowed folders (default
  `AI/`) is refused**. For the whole vault use `--write-folder .`. You can repeat the allowed folder (`--write
  --write-folder AI --write-folder Journal`). If the daily note folder is not allowed, `append_to_daily_note` is refused
  with `forbidden-folder`. The settings screen validates folders with the same rules as the server, and when a folder
  contains `..`, starts with a dot, or has an empty segment it does not make a snippet and shows the reason (registering it
  anyway would make the server fail at start with `PolicyError`, hiding even the read tools).
- Path checks: absolute paths, `..`, folders or files starting with a dot (`.nopsidian`, `.git`), and unusual characters
  are refused, and symbolic links are not followed.
- Existing notes can only be appended to or replaced after checking the latest hash. The content from before an overwrite
  stays in the note's **version history** and can be restored (the same save path as the app).
- Write rate (default 30 per minute) and size per write (1 MB) limits.
- **Audit log and revert**: every write and every refused attempt is recorded in the vault's `.nopsidian/mcp-audit.jsonl`
  and shown under **Recent agent activity** in the settings screen. **Revert** next to an entry restores the content from
  before that action (the current content stays in the version history); a note the agent created goes to the trash. If
  the note changed again after that (by a person or an agent) the revert is refused, so start from the most recent action.
- Note content is untrusted data (prompt injection). The server instructions tell agents not to follow instructions found
  inside notes, but for sensitive vaults read-only is the safer setting.

## Structure
`packages/mcp`: `folders.ts` (folder normalization and containment used by both the server and the app) · `policy.ts`
(argument, path, and folder checks) · `vault-scan.ts` (read-only in-memory cache of the disk scan: search and backlinks)
· `writer.ts` (writes that follow the policy, using `saveNote` from `@nopsidian/core`) · `audit.ts` · `server.ts` (tool
registration) · `cli.ts` (stdio — runs directly as `node nopsidian-mcp.mjs …`, and the app's `--mcp-stdio` mode calls its
`main(argv)`). `build.mjs` bundles it into one file with esbuild. The app only shows the executable, paths, and log
through `mcp.info`/`mcp.audit` IPC; it never talks to the server directly (the files are the truth).
