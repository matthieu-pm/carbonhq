# Always-on agents

A **standing agent** holds a job rather than a task. It wakes itself, works,
reports, and waits for the next wake. Each wake is a **run**: an ordinary
Carbon session. The model is Grok Bot, Claude Duet and OpenAI Dots. The
difference is where it runs: the reader's own agent CLI, on the reader's own
plan, in the reader's own repo, on a machine they already own.

Written against `main` at `03c1b12`. Agreed with Matthieu on 2026-11-12: build
this in Carbon, not on OpenBot. Everything else here is a proposal. "Standing
agent" and "run" are working names. The picks under
[Decisions to take](#decisions-to-take) are mine and not yet his.

## What the three products do

| | Grok Bot | Claude Duet | OpenAI Dots |
|---|---|---|---|
| a computer that stays up | shared cloud computer | own cloud computer | own cloud computer |
| wakes itself | yes | checks accounts every few hours | yes |
| speaks first | yes | morning brief, pings when done or stuck | yes |
| remembers | learns preferences | account memory and skills | yes |
| asks before risk | learns when to ask | send, pay, sign, delete | rules: allow, ask, block |
| a team | chief of staff over specialists | no | no |

Five parts, then: a computer, a trigger, a channel to the reader, memory, and
approval gates. A sixth, delegation, is Grok's alone.

## Why not OpenBot

CopilotKit's OpenBot is an open-source copy of this shape. Its bots call model
APIs themselves and work in a container, so it replaces the two things Carbon
is built on: the vendor's CLI and the reader's checkout. It also needs Docker,
Postgres and a worker, and its memory needs a separately licensed service.
Worth reading for how it draws routines. Not a dependency.

## What already exists and is reused

| need | already here |
|---|---|
| a computer that stays up | `carbon --serve` under launchd `KeepAlive` on a Mac; `carbon-serve` on a VPS |
| a timer that survives a restart | [auto_continue.rs](src-tauri/src/auto_continue.rs): the schedule is stored, and `rearm` runs at server start (`serve.rs:417`) |
| a saved task with every pick | `Draft` in [useDrafts.ts](src/hooks/useDrafts.ts): prompt, project, harness, model, effort, stance, fast, worktree, base |
| starting that task with no window | `start_session` in [orchestration.rs](src-tauri/src/orchestration.rs), the half of `start_draft` that leaves the draft file alone |
| an agent calling `carbon` unasked | Claude Code is spawned with `--allowedTools "Bash(carbon:*)"` |
| running it on another machine | `--machine` |
| delegating | `carbon session new`, depth cap 2, the crew column |
| approval | permission and question cards, already on the app, the island and iOS |
| memory the reader can read and edit | Pages: `carbon pages read` and `update`, with revisions |
| what it cost | `tokens` on the index entry, counted off the log |
| a run dying on the usage limit | auto-continue |

New dependency: none.

## What is missing

1. **A trigger.** Nothing starts a session on a clock or on an outside event.
2. **A stance that runs alone.** A session started with no one watching stops
   at its first card.
3. **Reporting back.** A parent cannot read a child's transcript, or learn it
   finished without polling `carbon session ls`.
4. **Reaching the reader when no Carbon window is open.** iOS has no push.
5. **A place to see standing agents.**

## Design

### A run is a fresh session

Each wake starts a new session. It does not send a prompt into one long
session. Two reasons:

- **Cost per wake stays flat.** Wakes are hours apart, so the prompt cache has
  expired by the next one and the whole context is written again. A fresh
  Claude Code session measured about 45K tokens for its first turn. A long
  session pays its full transcript each wake, and that grows until it compacts.
- **Compaction loses detail the agent chose nothing about.** A memory page the
  agent rewrites itself keeps what it judged worth keeping.

The cost is that an agent's history is spread over many sessions. The UI
groups them.

### The record

`standing.json` in `CARBON_HOME`, beside `drafts.json`, with its own lock and
write-temp-then-rename. Per home, never in `store::config_dir`: two servers
sharing a record would both wake it.

A record is a draft plus a name, triggers, a memory page and a last run. It
reuses `Draft`'s fields so a run starts through `start_session` as a draft
does. `start_draft` itself takes the draft out of its file first, which a
record must not copy.

Rust holds triggers as untyped JSON it reads field by field, the way drafts
are held. A trigger kind an older build cannot spell must cost that trigger,
never the file.

A run's index entry carries `standing_id`. That is the join for grouping and
for cost. `serde(default)`, and an older build carries it through `unknown`.

### Triggers

Phase 1 has two kinds, both in the server's local time:

- every N minutes, floor 30
- at a time of day, on chosen weekdays

No cron syntax: nothing here needs it and it is a parser to carry.

One loop wakes each minute and compares wall-clock time. It does not sleep
until the next wake. A long sleep on a Mac is suspected to run late by however
long the lid was shut; see [To verify](#to-verify-before-building).

Rules for firing:

- An overdue wake fires once, not once per slot missed.
- A wake is skipped while that agent's last run is still mid-turn or holds a
  card. Skips are recorded on the record so the row can say why.
- A wake is skipped while any session on that harness holds a `continue_at`
  still ahead. That field is how the server already records a usage limit.
- A daily cap on runs per agent, default 12.

**A sleeping Mac runs nothing.** "Always on" on a laptop means "while awake".
The machine picker says so, and a VPS is the answer for real always-on.
Waking a Mac on a timer needs root and is out.

### Stance

The record names its stance, and only a person sets it. Two are offered:

- **Read and report** (`plan`). Changes nothing. Right for a brief or a watch.
- **Work in a worktree** (`auto`, worktree on). Cards go to the reader.

`bypassPermissions` can be picked and is never the default.

An agent may create a standing agent with `carbon standing new`. That record
is clamped to the caller's stance and starts paused. A person turns it on.
Without both, a `plan` session could schedule itself a `bypassPermissions`
future.

Phase 2 applies the same clamp to `carbon session new`: a child is never more
autonomous than its parent. CLAUDE.md already names this as the likely fix.

No rule editor. Rules stay the CLI's own.

### Memory

One Page per standing agent, made when the agent is, its id on the record.
The server builds each run's prompt: the job, then "read this page first, and
before you finish rewrite it with what the next run needs". The reader can
open the page, edit it, and walk its history.

### Reporting back

A run's last message is its report. The agent's row shows its first line.

Two new CLI verbs close the gap for delegation:

- `carbon session wait <id>` ends when that session's turn ends, with a
  timeout. One bounded background task, which is what
  [system_prompt.md](src-tauri/src/harness/claude_code/system_prompt.md)
  already asks for.
- `carbon session read <id>` prints a session's last message, or its tail.

Both are new requests, so `PROTOCOL_VERSION` moves from 14 to 15. So does
`carbon standing` in phase 1, whichever lands first.

A morning brief is then no feature of its own. It is a standing agent on
Read and report whose job is "say what ran since yesterday".

### Reaching the reader

Phase 1 uses what exists: the desktop banner, the island, and the iOS app
while it is open.

Phase 3 adds a **notify URL** in Settings. The server POSTs a title and a
session id there when a run finishes or wants an answer. That covers ntfy,
Slack and Telegram, works from a VPS, and nothing of ours runs anywhere.

Real iOS push needs a relay that holds Carbon's APNs key. It would be the
first service Carbon runs. It gets its own plan.

### Where it shows

A sidebar view of its own, beside active, settled and drafts, for the reason
drafts got one: mixed into the live list, a standing agent reads as a session.

A row: name, next wake, the last report's first line, and one state out of
sleeping, running, waiting on you, paused. Opening one shows the job, its
triggers, stance, machine, memory page, tokens spent, and its runs.

Runs stay out of the active list and draw under their agent. A run holding a
card still lights the rail.

`carbon standing new|ls|run|pause|resume|rm` writes the same file over the
socket and emits `standing_changed`, the way `carbon draft` does.

Read [DESIGN.md](DESIGN.md) before drawing any of it. A demo page,
`demo/standing-agents.html`, mounts the view over faked records.

iOS decodes leniently, so a run shows there as an ordinary session until the
app is taught `standing_id`.

### Cost

- The agent's row sums `tokens` over its runs.
- The interval floor and the daily cap above are the only limits. No budget
  in tokens: a run cannot be stopped fairly halfway through a turn.
- A run that dies on the limit is auto-continue's, unchanged.

## Phases

1. **Scheduled runs.** `standing.json`, the minute loop, the two stances, the
   memory page, the sidebar view, `carbon standing`. Done when an agent made
   in the UI fires on time with the app quit, survives a server restart, skips
   while a run is open, and shows what it spent.
2. **Delegation.** `session wait`, `session read`, the stance clamp on
   spawned sessions.
3. **Reach.** The notify URL. Then the APNs relay's own plan.
4. **Event triggers.** A PR's checks failing, a Linear issue assigned, an
   inbound `POST /hook/<id>`. PR triggers ride the sidebar's existing marks
   poll and add no `gh` call: that budget is already a known issue.

Each phase is one Linear issue.

## Left out

- Connectors. Each CLI's own MCP setup already supplies them.
- A cloud computer Carbon hosts.
- Learning when to ask, which is Grok's.
- Agents chatting on a shared computer, past `carbon session send`.
- Waking a sleeping Mac.

## Decisions to take

1. **Fresh session per wake, or one long session?** Pick: fresh.
2. **The name.** "Agent" already means a session's harness in Carbon.
   "Routine" is what Claude Code and OpenBot call a scheduled prompt.
3. **Memory in a Page, or a plain file under `CARBON_HOME`?** Pick: Page. A
   file needs no flag and no CLI call, but the reader cannot see or edit it.
4. **Default stance.** Pick: Read and report.
5. **What becomes of old runs?** Settling one deletes its worktree, so
   auto-settle can lose work. Pick: leave them, show a count, let the reader
   settle.
6. **Notify URL before APNs?** Pick: yes.
7. **Allow This Mac as the machine?** Pick: yes, with the sleep caveat stated
   in the picker.

## To verify before building

- **Timers across Mac sleep.** Suspected: tokio's sleep counts uptime, which
  stops while the Mac sleeps. If so, auto-continue's single long sleep has the
  same exposure.
- **Pages with the flag off.** The UI sits behind `pagesEnabled`. Does
  `carbon pages` answer without it?
- **`carbon` calls without a card.** Claude Code allows `Bash(carbon:*)` on
  spawn. Does that hold under `plan`, where the memory page must still be
  rewritten? And what do Codex, fx, grok and pi do?
- **Cold-wake cost.** Measure a fresh run against a prompt into a long idle
  session, on the default model. The 45K figure is one Haiku turn.

## Sources

Product details come from news coverage and vendor pages, not hands-on use.

- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot)
- [Claude Duet](https://claude.com/product/claude-duet)
- [The Decoder on Claude Duet](https://the-decoder.com/anthropic-takes-on-grok-bot-metas-muse-and-openais-dots-with-its-always-on-agent-claude-duet/)
- [Dots](https://chatgpt.com/features/dots/)
- [CopilotKit/openbot](https://github.com/CopilotKit/openbot)
