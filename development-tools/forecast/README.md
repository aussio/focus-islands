# Forecast preview tool

Render a supplied scenario file as a self-contained HTML page using the same day-path component as the app's Today view:

```bash
node development-tools/forecast/build.js scenarios.json preview.html
```

The input may be one scenario object or an array. Every scenario needs `date` (`YYYY-MM-DD`) and `now` (`HH:mm`, local time). Optional `name` and `note` fields appear in the page.

| Field | Shape |
| --- | --- |
| `plan` | `{ start, end, focusMinutes, breakMinutes, meetings }`; times use `HH:mm`. Defaults to 9:00–17:00, 60-minute focus, and 10-minute breaks. |
| `meetings` | Array of `[start, end, title]`, either at the top level or in `plan`. |
| `history` | Array of `[kind, start, end, confirmed]`. Kinds are `focus`, `break`, and `away`; `confirmed` matters for breaks. |
| `active` | `{ phase, start, targetMinutes, elapsedMinutes, isDue }` for a running focus or break timer. |
| `decisions` | Array of `[kind, time, minutes]` for `breakSnoozed` or `breakSkipped`. |

The tool calculates forecasts in memory. It does not open any app profile database. The output HTML embeds the supplied scenario values so it can be opened locally without a server.
