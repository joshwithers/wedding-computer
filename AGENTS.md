# AGENTS.md — Wedding Computer

All agent instructions for this project live in [CLAUDE.md](CLAUDE.md) — read that file in full before working here.

It is kept as the single source of agent guidance so the two files can't drift apart. Key facts you must not get wrong (details in CLAUDE.md):

- The project is **closed source** — never describe it as open source or AGPL.
- The live domain is **wedding.computer**.
- The data model's source of truth is **schema.sql** (and `src/types.ts`), not any doc.
- All new UI strings go through the i18n layer (`src/i18n`, `t()`), and all dates through `src/lib/date.ts`.
