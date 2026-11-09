# Persist Notes MCP server

[Português](README.pt-BR.md)

An [MCP](https://modelcontextprotocol.io) server that gives Claude (Claude Code, Claude Desktop or any MCP client) **read-only** access to your [Persist Notes](https://persistnotes.com) meetings: search across summaries and transcripts, read a meeting summary, list pending action items and decisions, browse projects and their living synthesis, and read your weekly/monthly period summaries.

Persist Notes saves every meeting as a plain Markdown file (frontmatter + summary + your notes + transcript). This server reads those files directly. It does not need the Persist Notes app to be running, or even installed, as long as you have the notes folder.

## Privacy

- **Local only.** The server runs on your computer over stdio. It opens no network connections and sends nothing anywhere by itself.
- **Read-only.** It never creates, changes or deletes files. Inside the server process, every file-writing function is blocked.
- **What Claude sees.** Only the text that a tool returns (excerpts, summaries, action items) goes to Claude, as part of your conversation. Audio files are never read.

## Requirements

- Node.js 18 or newer (`node --version`).
- A Persist Notes notes folder (by default the app uses `~/Documents/Persist Notes`; you can see yours in the app under Settings).

## Configuration

The server finds the notes folder in this order:

1. `--notes-dir "<path>"`
2. the `PERSIST_NOTES_DIR` environment variable
3. `notesDir` in the Persist Notes app settings (`~/Library/Application Support/Persist Notes/settings.json` on macOS, `%APPDATA%\Persist Notes\settings.json` on Windows, `~/.config/Persist Notes/settings.json` on Linux)
4. `~/Documents/Persist Notes`

### Claude Code

```bash
claude mcp add persist-notes -- npx -y @persistnotes/mcp --notes-dir "/Users/you/Documents/Persist Notes"
```

Add `--scope user` to make it available in every project. Check it with `claude mcp list`.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "persist-notes": {
      "command": "npx",
      "args": ["-y", "@persistnotes/mcp", "--notes-dir", "/Users/you/Documents/Persist Notes"]
    }
  }
}
```

On Windows use a path like `"C:\\Users\\you\\Documents\\Persist Notes"`.

### Options

| Option | Meaning |
|---|---|
| `--notes-dir <path>` | Notes folder (see the order above) |
| `--lang en\|pt-BR\|es` | Language of error messages (default: system language) |
| `--legacy-tools` | Also list the Portuguese tool names of the server bundled with the app |
| `--version`, `--help` | Version and usage |

## Tools

| Tool | What it does |
|---|---|
| `search_meetings` | Full-text search (BM25) across summaries, your notes, transcripts and period summaries; returns excerpts with meeting, date and section |
| `list_meetings` | Meetings, newest first; filter by project and date range |
| `read_meeting` | The summary sections of one meeting; `full: true` returns the whole file (with transcript), `include_notes: true` adds your notes |
| `list_actions` | Action items from the "Next steps" of the summaries, with owner, due date and status (`open`, `done`, `all`) |
| `list_decisions` | Decisions recorded in the summaries, with date and meeting |
| `list_projects` | Projects (folders), number of meetings and whether they have a synthesis |
| `read_project_synthesis` | The living synthesis of a project (`_synthesis.md`) |
| `list_period_summaries` | Period summaries saved in `summaries/` |
| `read_period_summary` | One period summary (the latest by default) |

All tools are read-only (`readOnlyHint`). Section titles are recognized in Portuguese, English and Spanish.

For compatibility with the server bundled with the Persist Notes app, the Portuguese names (`buscar`, `listar_reunioes`, `ler_reuniao`, `commitments`, `decisoes`, `listar_projetos`, `sintese_projeto`) are also accepted, with the same output.

## Troubleshooting

- **"Notes folder not found"**: pass the right folder with `--notes-dir` (quote paths with spaces) and restart the client.
- **"Permission denied" / `EPERM` on macOS**: the Documents folder is protected. Allow the app that starts the server (Claude, Terminal, your editor) in System Settings → Privacy & Security → Files and Folders (or Full Disk Access), then restart it.
- **`npx` not found in Claude Desktop**: Claude Desktop may not see your shell `PATH`. Use the full path to `npx` (`which npx`) as `command`.
- **Empty results**: check that the folder has the meeting `.md` files (meetings in the root, projects as subfolders). Run `npx -y @persistnotes/mcp --notes-dir "<path>"` in a terminal: the first line on stderr shows which folder it is using. Stop it with Ctrl+C.
- **Logs**: Claude Code: `claude mcp list` / `claude --debug`. Claude Desktop: `~/Library/Logs/Claude/mcp-server-persist-notes.log` (macOS), `%APPDATA%\Claude\logs` (Windows).

## Development

The server reuses the read-only modules of the Persist Notes app. `npm run build` (also run by `npm pack`/`npm publish`) copies them unchanged into `dist/`; `src/server.js` is the entry point.

## License

MIT
