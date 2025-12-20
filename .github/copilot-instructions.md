Canonical agent documentation: /AGENTS.md

Rules:
- Keep diffs minimal; prefer small, focused commits.
- Do not invent endpoints, ports, or workflows — preserve existing ports/paths exactly.
- When APIs or command-line workflows change, update `/AGENTS.md` accordingly.
- Prefer small commits and conservative edits; avoid broad refactors.

Preferred workflow:
- Use `Launch GSM Server.py` for development and local testing.
- Use manual `node backend/server.js` / `npm --prefix frontend run dev` only when necessary.

Maintainer: repository owner
