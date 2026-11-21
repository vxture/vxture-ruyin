# P18 - Desktop background lifecycle

Registered 2026-11-22 under the standing local RY registration exception.
Platform sources, existing installed runtimes and historical data remain outside
this batch. RUYIN identity/business boundaries remain Accounts/Console.

| Batch | Implementation | Acceptance |
| --- | --- | --- |
| P18.1 | Main-window close hides to a branded tray; Open restores the same window; second launch restores the existing instance | No renderer destruction, duplicate daemon, task interruption or scope change |
| P18.2 | Explicit Exit/Restart checks machine execution activity and asks when busy/unknown; cancel is the default | One dialog at a time; cancelling neither exits nor schedules a relaunch |
| P18.3 | Preserve daemon/page execution while hidden and existing durable task recovery on restart | Real delayed work finishes while hidden; saved results survive process restart |
| P18.4 | Shell/host regression, desktop integration evidence and failure handling | Tray failure cannot strand the app; OS session shutdown is not blocked; no installed executable replacement |

Window close defaults to hiding while a working tray exists. The first close per
process explains background operation and how to exit. Tray commands are Open
RUYIN and Exit RUYIN; double click/Open/second launch restores the existing
window, current page and account. The hidden renderer is kept alive with
background throttling disabled so autosave timers are not suspended. No
auto-start, scheduled task or extra service is installed. Exit stops local
execution; this feature does not promise execution during machine sleep/off.

Local RY-102 additive read: authenticated GET `/runtime/activity` returns only
machine-wide counts: running/queued contract tasks, runnable batches, reading,
render and component-download operations, plus `initializing` and derived
`busy`. It exposes no project names, IDs, contents or platform credentials.
Waiting-human/paused batches alone do not constitute executing work. Initialization
counts as busy; failed activity reads are unknown, never assumed idle.

Only explicit quit/restart checks activity. Confirmation states that local
execution is interrupted, saved results remain, resumable tasks recover on next
startup and interrupted reading/render operations may require retry. It does
not cancel task records or claim every external effect can be replayed safely.
App restart defers relaunch until confirmation. System shutdown and fatal
startup/daemon errors retain their existing exit behavior. Tray creation
failure falls back to a normal guarded close rather than hiding an unreachable
window. Single-instance ownership is per Chromium profile; smoke runs remain
independent. An explicit development profile override supports isolated tests.

Existing task/job recovery remains behind connector readiness (P16). Test the
actual persisted job/task records across restart, not only an in-memory mock.
Test fixtures and evidence stay outside user data; no real model calls are
needed. Windows OS policy blocks must be reported, not bypassed.

Next batches remain P19 agent installation management, P20 manual local backup
and restore, P21 diagnostics and P22 complete packaged acceptance. Deferred
platform work stays deferred, including P15.6/P17.2/P17.4.

Owner addition before implementation: Settings -> General includes Window
close behavior: Keep running in background (default) / Exit application. Save
the preference in this runtime's local data directory, not account/cloud or
browser storage. The shell reads it on each close, so edits apply immediately
without restart and remain consistent across browser/desktop clients. Choosing
Exit still uses the busy/unknown confirmation gate. Add authenticated GET/PUT
`/ui/window-close` with `{action: background | exit}`; unconfigured hosts return
503, invalid writes return 400 and failed writes never report success. Missing
or malformed saved preferences safely default to background. Use existing
Settings row/select patterns and localized help; no further settings surface.
Owner wording: the row is simply “关闭窗口” / “Close window”; options are
“后台运行” / “Keep running” and “退出应用” / “Exit app”.

Owner follow-up: spell the English exit option in full as “Exit application”.
Match the audit footer's shared note spacing. State explicitly that background
work stays in the system tray, double-click restores the window, and the tray's
right-click menu includes “Exit RUYIN” / “退出 RUYIN”.

Owner copy refinement: keep the settings footer to one short sentence about
continuing background tasks and exiting from the system tray. Double-click
instructions remain in the first-close notification rather than this footer.

## Acceptance - 2026-11-22

P18.1-P18.4 are implemented and accepted against current development sources.
Installed-release acceptance remains P22; this batch does not replace the
installed executable or change platform APIs.

- Shell: 64 tests pass, 100% line/function and 97.14% branch coverage. The
  lifecycle state machine itself has 100% line/branch/function coverage.
- Local host: 852 tests pass on the installed signed Node 22 runtime; coverage
  is 96.85% lines, 89.84% branches and 92.83% functions.
- Workspace: 777 tests pass with existing coverage gates unchanged; 100% lines,
  99.57% statements, 96.26% branches and 99.06% functions. The first parallel
  run had timeouts in an existing catalog test and a main-wiring test file;
  separate supported-runtime runs passed with no relaxed timeout or gate.
- Actual Electron 42.11.18 imported the current shell and forked the actual
  daemon in an isolated encrypted data directory. A signed synthetic agent
  package and loopback model service exercised eight checks: hidden window
  preserves renderer/page/timers; task and autosave finish while hidden; tray
  restore uses the same window; second launch restores that same instance;
  busy quit cancels by default; a saved exit preference applies immediately;
  cancelling restart schedules no relaunch; accepted restart retains scope,
  encrypted results and preferences and recovers an interrupted durable task.
  Idle close with the exit preference also stops the runtime. Native message
  box responses were automated; real installer/manual-dialog acceptance is
  still separate. Fixture model requests total five; no customer/model data
  was transmitted.
- Real-account development host 62517 was idle with zero projects, running
  tasks, batches and downloads before restart. Only that verified development
  process was restarted. The existing account and workspace were retained.
  General settings saved Exit, retained it after reload and restored Background
  as the final value. Short labels and select layout were visually checked.
- Notification failures cannot interrupt background work; failed hide/tray
  creation uses guarded exit; OS session end during preference/activity reads
  or confirmation cannot later hide the window or schedule a relaunch.
  Any unexpected daemon exit now exits the shell with failure, including code
  zero, so a packaged tray cannot remain alive with a missing runtime.

Evidence: the task attachment directory `p18-background/` contains
`desktop-result.json`, isolated Electron logs, supported-runtime test logs and
`general-close-setting.jpg`. An additional broad smoke run was stopped at its
45-second probe limit while the existing uvx self-check was pending; it did not
reach the PDF marker and is not counted as packaged acceptance.
