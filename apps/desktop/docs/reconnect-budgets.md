# Reconnect budgets

CBN-105, measured locally on 2026-11-16. These are synthetic normalized-event
workloads, not a measured production regression. The implementation and wire
contract are in [server and transport](server-and-transport.md#reconnect-state-and-protocol-changes).

## Replay payload

`store::page_tests::measure_reconnect_baseline` runs the previous unbounded
reader and the bounded recovery reader against the same in-memory JSONL.
The client holds the first event and disconnects for the rest. Sizes below
are encoded JSON bytes; bounded results include the recovery envelope.

| Log workload | Previous reply | Bounded reply | Returned events | Outcome |
| --- | ---: | ---: | ---: | --- |
| 256 events, 1 KiB text each | 302,215 | 302,259 | 255 | Replay |
| 4,096 events, 1 KiB text each | 4,862,647 | 608,303 | 512 | Tail reset |
| 1,024 events, 16 KiB text each | 16,926,391 | 2,084,892 | 126 | Tail reset |
| 8 events, 2 MiB text each | 14,681,171 | 2,097,358 | 1 | Single large event tail |

512 events bounds object overhead for many small messages. 2 MiB preserves
the small replay and cuts the larger examples before parsing their entire
missed stretch. A single event larger than 2 MiB is read intact in a tail
page, not replayed past the byte limit. Earlier events remain pageable.
The raw read buffer normally holds at most 2 MiB plus one byte. It grows
only to finish a large final event, with a 64 MiB guard matching the wire.

Run from `apps/desktop/src-tauri`:

```bash
cargo test --lib measure_reconnect_baseline -- --ignored --nocapture
```

The test prints timings too. Payload sizes determine these limits; debug
timings vary with concurrent builds and are not a latency guarantee.

## Concurrent recovery over WebSocket

`scripts/measure-reconnect.mjs` starts the built headless server with a scratch
home and seeds 32 independent sessions. Each log contains 1,024 events with
16 KiB of text. It requests all 32 recoveries concurrently on one connection,
then pages one session back to its beginning and checks a short event-ID
resume. No agent process runs.

| Measurement | Result |
| --- | ---: |
| Encoded reconnect replies, 32 sessions | 66,844,779 bytes |
| Recovery time on loopback, debug build | 441 ms |
| Server RSS before recovery | 32,276,480 bytes |
| Peak sampled server RSS during recovery | 225,361,920 bytes |
| Complete history checked by paging | 1,024 events, in order, unique |

RSS was sampled every 50 ms and may miss shorter peaks. The server's total
RSS includes active command results and serialization buffers, not just its
outgoing queue. The previous reader's equivalent 32-session reply size is
about 542 MB from the in-memory measurement; that figure is an extrapolation,
not a second live-server benchmark.

Run from `apps/desktop` with Node 22 or newer:

```bash
cd src-tauri && cargo build --no-default-features --features serve --bin carbon-serve
cd .. && node scripts/measure-reconnect.mjs
```

## Slow or disconnected readers

Each client shares a 256-frame / 64 MiB budget across live events, replies
and host calls. Accounting includes the frame currently writing. 64 MiB
allows the 32 concurrently admitted normal-size recovery responses and
individual larger events; 256 frames also caps small-message overhead.
Overflow closes the connection instead of waiting on it or silently dropping
committed output. A 20-second write deadline also ends an idle stalled writer.

The Rust suite verifies byte and item accounting, release on dequeue/drop,
closed readers, a stalled socket while its writer is blocked, and a fast
subscriber receiving all output beside a stalled one. Reconnection restores
pending questions, background tasks and the current prompt queue before later
live output. Store tests page complete histories through event and byte
cutoffs, including a 4 MiB single event and subagent sequence resets. Desktop
and Swift tests check ordering and deduplication at the replay/live boundary.

Admitted commands finish after a disconnect; losing their replies does not
automatically repeat them. Durable session data and secret handoff storage
are unchanged. These limits do not add task or delivery persistence.
