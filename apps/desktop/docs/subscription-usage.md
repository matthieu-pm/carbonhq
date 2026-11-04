# Subscription usage

The circle beside Settings shows remaining subscription allowance across Codex,
Claude Code and Grok. It drains clockwise from a full ring to an empty one, with
the diamond from the design reference in its centre. Clicking it opens the usage
card. This is account usage on the local machine, independent of the selected
project, session or remote server.

Each subscription contributes its lowest remaining percentage across its reported
windows. The circle shows the average of those percentages, with equal weight per
subscription. These allowances cannot be transferred or added as token counts.
Missing, failed, stale and reset readings are excluded, and
the card says how many subscriptions were excluded. No readings produces a dashed
ring and no percentage. A real zero remains zero.

The card repeats the usage ring beside the combined percentage. Account settings
opens from the gear beside Refresh, with its name in a tooltip. Provider separators
span the card; content keeps its own inset.

`subscription_usage` in the server command table reads account data through the
installed CLIs. It opens no conversation, sends no prompt and keeps no credential:

- Codex: `account/rateLimits/read` through the existing app-server probe. A
  weekly-only primary window remains weekly; primary does not always mean five
  hours. See the [official app-server protocol](https://developers.openai.com/codex/app-server).
- Claude Code: stream-json `initialize`, then `get_usage` with
  `skip_behaviors: true`. Read `rate_limits`, excluding paid extra usage.
- Grok: ACP `initialize`, then `_x.ai/billing`. Read
  `config.creditUsagePercent` and `config.currentPeriod`, excluding purchased
  credits. The leading underscore is required on the extension method.

These were checked against installed Codex 0.166.0, Claude Code 2.1.318 and Grok
1.0.70 on 2026-11-04. Claude's usage control and Grok's billing extension can change;
an unfamiliar or refused response must become unavailable, never 100% remaining.

Probes run concurrently, have deadlines, and kill their child processes and
descendants afterwards. The server coalesces reads for 60 seconds and manual
refreshes for five seconds. The frontend polls once a minute while visible and
focused, and refreshes after returning to the app. Readings expire after two
minutes or when any reported reset time is reached. Last known values are labelled
and excluded until refreshed.

`demo/subscription-usage.html` mounts the real control with fixture responses for
full, empty, low, partial, unavailable, loading, stale and error states. It includes
the shared theme controls. Pure percentage/reset rules have frontend tests;
provider normalization has Rust tests. The ignored `live_subscription_usage` test
checks installed, signed-in CLIs without a model call.
