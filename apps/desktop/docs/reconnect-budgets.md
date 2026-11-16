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
The raw read buffer starts at 16 KiB and normally holds at most 2 MiB plus
one byte. Growth reads only the preceding bytes. It grows beyond that only
to finish a large final event, with a 63 MiB guard leaving envelope headroom
under the wire limit. Long turns also recover compact prompt/baseline context
without parsing all of the missing events.

Run from `apps/desktop/src-tauri`:

```bash
cargo test --lib measure_reconnect_baseline -- --ignored --nocapture
```

The test prints timings too. Payload sizes determine these limits; debug
timings vary with concurrent builds and are not a latency guarantee.

## Concurrent recovery over WebSocket

`scripts/measure-reconnect.mjs` starts the built headless server with a scratch
home and seeds 32 independent sessions, plus short-turn and oversized-event
fixtures. Each long log contains a prompt and 1,023 text events of 16 KiB.
It requests all 32 recoveries concurrently on one connection,
then pages one session back to its beginning and checks a short event-ID
resume. No agent process runs.

| Measurement | Result |
| --- | ---: |
| Encoded reconnect replies, 32 sessions | 66,846,475 bytes |
| Recovery time on loopback, debug build | 1,521 ms |
| Server RSS before recovery | 32,440,320 bytes |
| Peak sampled server RSS during recovery | 234,225,664 bytes |
| Complete history checked by paging | 1,024 events, in order, unique |
| Short-turn replay past eight turns | 19 events, no reset |
| Concurrent command burst on the same socket | 128 calls, all completed |
| 64 MiB log event | Explicit command error, socket remained open |

The revised fixture starts each long turn with a prompt and includes the
cost of recovering its baseline outside the bounded tail. The earlier
441 ms run had no prompts and did not time this context lookup.

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

Review exposed a mixed-workload hole in the original 256-frame / 64 MiB
queue: recovery responses competed with token bursts. The revised queue
keeps the previous 4,096-event allowance and caps retained JSON at 128 MiB,
including the frame being written. That leaves room for 32 responses near
2 MiB each plus live state. Previews can consume at most 16 MiB and leave
128 frame slots reserved; they are dropped under pressure, preserving wire
order for the committed events that replace them. A regression holds 32
2 MiB replies while publishing 10,000 token deltas, then verifies committed
output still arrives without closing the connection.

Committed-event overflow still disconnects instead of silently dropping
history. An oversized reply fails its call explicitly and keeps the socket
open. The 33rd command waits for admission. Write deadlines scale at 20
seconds plus a second per 32 KiB of JSON, so a 2 MiB frame has 84 seconds
and can finish over a 500 kbps link.

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
