import { memo as _$memo } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createSignal, createMemo, For, Show, onCleanup, createEffect } from "solid-js";
import { MAX_DIRECTORIES, SessionHistory } from "./rpc.js";
import { filterSessions, homePanelWidth, mergeSessions, projectLabel, scopeToCurrentProject } from "./sessions.js";

/**
 * CLI plugin: append a Session History panel into the built-in sidebar.
 *
 * Behavior:
 *  - Lists sessions across every project, newest first, by default. When
 *    `options.showAllProjects` is false it is scoped to the current project.
 *  - Search box filters by title, id, project, or directory. OpenCode's
 *    renderer disables click-to-focus and the slot host does not focus plugin
 *    content, so the field is focused on click; escape clears the query, then
 *    blurs back to the prompt. Arrow/Enter navigation is scoped to the field so
 *    the prompt keeps those keys.
 *  - Click/Enter on a row: if the session is already open in a tab, focus
 *    it; otherwise open + focus the tab. When tabs are disabled, fall back
 *    to router.navigate({ type: "session" }).
 *  - Sessions whose working directory is gone on the server are dimmed and
 *    marked "✗ missing" in red. Activating one warns first (a dismissible 3s
 *    toast that never navigates); activating it again opens it anyway. This is
 *    not "deleted" — that is a different state (the session record itself),
 *    which never appears in the list.
 *
 * Cross-project listing: `context.data.session.list()` only reflects the
 * sessions the CLI has already cached (mostly the current location), so when
 * listing all projects we also page the full server index via
 * `context.client.session.list({})` and merge the reactive cache on top.
 */
export default Plugin.define({
  id: "session-history",
  setup(context) {
    const limit = context.options.limit ?? 100;
    const showMetrics = context.options.showMetrics ?? true;
    const showAllProjects = context.options.showAllProjects ?? true;

    // Ensure project + session stores are populated.
    void context.data.project.sync().catch(() => {});
    // Tabs.enabled() gates the click path; we don't pre-sync sessions here
    // because context.data.session.list() returns whatever is loaded.

    const stopCreated = context.data.on("session.created", () => {
      // Session lifecycle event triggers a refresh. The data store is
      // reactive and already reflects most fields; this just nudges the UI.
      void context.data.project.sync().catch(() => {});
    });
    const stopRenamed = context.data.on("session.renamed", () => {
      void context.data.project.sync().catch(() => {});
    });
    const stopMetadataUpdated = context.data.on("session.metadata.updated", () => {
      void context.data.project.sync().catch(() => {});
    });
    const stopUsageUpdated = context.data.on("session.usage.updated", () => {
      void context.data.project.sync().catch(() => {});
    });
    const stopDeleted = context.data.on("session.deleted", () => {
      void context.data.project.sync().catch(() => {});
    });
    onCleanup(() => {
      stopCreated();
      stopRenamed();
      stopMetadataUpdated();
      stopUsageUpdated();
      stopDeleted();
    });
    const disposeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: input => _$createComponent(SidebarHistory, {
        get activeSessionID() {
          return input.sessionID;
        },
        limit: limit,
        showMetrics: showMetrics,
        showAllProjects: showAllProjects
      })
    });

    // The CLI only renders a sidebar inside the session route, so the same
    // list is surfaced on the home screen through the global `app` slot.
    const disposeHome = context.ui.slot({
      append: "app",
      render: () => _$createComponent(HomeHistoryPanel, {
        limit: limit,
        showMetrics: showMetrics,
        showAllProjects: showAllProjects
      })
    });
    return () => {
      disposeSidebar();
      disposeHome();
    };
  }
});
const PAGE_SIZE = 100;
const MAX_FETCH = 500;

/**
 * Home-screen session panel. The CLI renders the sidebar only inside the
 * session route, so on the home route we mount the same list into the global
 * `app` slot as an overlay pinned to the right margin. The width is derived so
 * it never covers the centered home content; below that it stays hidden.
 */
function HomeHistoryPanel(props) {
  const context = usePlugin();
  const [terminalWidth, setTerminalWidth] = createSignal(context.renderer.terminalWidth);

  // The renderer width is a plain getter, so track resizes to show/hide the
  // panel as the terminal grows or shrinks.
  const onResize = () => setTerminalWidth(context.renderer.terminalWidth);
  context.renderer.on("resize", onResize);
  onCleanup(() => context.renderer.off("resize", onResize));
  const panelWidth = createMemo(() => homePanelWidth(terminalWidth()));
  const visible = createMemo(() => panelWidth() > 0 && context.ui.router.current().type === "home");
  return _$createComponent(Show, {
    get when() {
      return visible();
    },
    get children() {
      var _el$ = _$createElement("box");
      _$setProp(_el$, "position", "absolute");
      _$setProp(_el$, "top", 0);
      _$setProp(_el$, "right", 0);
      _$setProp(_el$, "height", "100%");
      _$insert(_el$, _$createComponent(SidebarHistory, {
        activeSessionID: undefined,
        get limit() {
          return props.limit;
        },
        get showMetrics() {
          return props.showMetrics;
        },
        get showAllProjects() {
          return props.showAllProjects;
        },
        align: "center"
      }));
      _$effect(_p$ => {
        var _v$ = panelWidth(),
          _v$2 = context.theme.background?.raised?.base;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "width", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "backgroundColor", _v$2, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$;
    }
  });
}
function SidebarHistory(props) {
  const context = usePlugin();
  const [query, setQuery] = createSignal("");
  const [stale, setStale] = createSignal(new Map());
  const [activeRow, setActiveRow] = createSignal(undefined);
  const [remote, setRemote] = createSignal([]);
  // Session the user has already been warned about; activating it again opens
  // it anyway (see `activate`).
  const [pendingOpen, setPendingOpen] = createSignal(undefined);

  // The filter input is focused explicitly. OpenCode's renderer disables
  // click-to-focus (autoFocus: false) and the slot host does not focus plugin
  // content, so an unfocused <input> never receives keystrokes. Focus it on
  // click and leave it with escape so it never steals focus from the prompt.
  let inputRef;
  const focusFilter = () => inputRef?.focus();
  const blurFilter = () => inputRef?.blur();

  // Full cross-project index from the server. The reactive store only holds
  // what the CLI has cached, so page the server list to enumerate every
  // project's sessions (newest first, top-level only).
  const loadAll = async () => {
    if (!props.showAllProjects) return;
    const collected = [];
    let cursor;
    do {
      const page = await context.client.session.list({
        order: "desc",
        limit: PAGE_SIZE,
        parentID: null,
        ...(cursor === undefined ? {} : {
          cursor
        })
      });
      collected.push(...page.data);
      cursor = page.cursor.next ?? undefined;
    } while (cursor !== undefined && collected.length < MAX_FETCH);
    setRemote(collected);
  };

  // Refresh the index when the set of sessions changes (debounced).
  let refreshTimer;
  const scheduleRefresh = () => {
    if (!props.showAllProjects) return;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void loadAll().catch(() => {}), 250);
  };
  void loadAll().catch(() => {});
  const stopCreated = context.data.on("session.created", scheduleRefresh);
  const stopDeleted = context.data.on("session.deleted", scheduleRefresh);
  const stopRenamed = context.data.on("session.renamed", scheduleRefresh);
  const stopMetadata = context.data.on("session.metadata.updated", scheduleRefresh);
  onCleanup(() => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    stopCreated();
    stopDeleted();
    stopRenamed();
    stopMetadata();
  });

  // Sessions before the query and row limit are applied — the freshness check
  // needs every directory, not just the visible rows.
  const allSessions = createMemo(() => {
    const cached = context.data.session.list() ?? [];
    const scoped = props.showAllProjects ? cached : scopeToCurrentProject(cached, context.data.location.default()?.directory, context.data.project.list() ?? []);
    return props.showAllProjects ? mergeSessions(remote(), scoped) : scoped;
  });

  // Reactive list of sessions, filtered by query and project scope.
  const sessions = createMemo(() => filterSessions(allSessions(), query(), context.data.project.list() ?? []).slice(0, props.limit));

  // Dim summary line: how many rows are shown and how many of them are missing.
  const summary = createMemo(() => {
    const total = sessions().length;
    const missing = sessions().filter(s => stale().get(s.location.directory) === false).length;
    const count = `${total} ${total === 1 ? "session" : "sessions"}`;
    return missing > 0 ? `${count} · ${missing} missing` : count;
  });

  // The distinct directories to check. Compared by value so a re-render that
  // does not change the set never re-runs the freshness check.
  const sessionDirectories = createMemo(() => [...new Set(allSessions().map(s => s.location.directory))].sort(), [], {
    equals: (a, b) => a.length === b.length && a.every((directory, index) => directory === b[index])
  });

  // Freshness pass: one batched RPC at this location reports which session
  // directories are gone on the server. It runs server-side, so it also holds
  // for a remote server and covers sessions from every project.
  const [checkTick, setCheckTick] = createSignal(0);
  let retryTimer;
  onCleanup(() => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
  });
  createEffect(() => {
    checkTick(); // re-run dependency for retries
    const directories = sessionDirectories().slice(0, MAX_DIRECTORIES);
    if (directories.length === 0) {
      setStale(new Map());
      return;
    }
    const rpc = context.client.rpc(SessionHistory);
    const location = context.location ?? context.data.location.default();
    void rpc.check({
      directories
    }, {
      location
    }).then(result => {
      const missing = new Set(result.missing);
      setStale(new Map(directories.map(directory => [directory, !missing.has(directory)])));
    }).catch(() => {
      // Fail open (no row dimmed) and retry shortly: a transient
      // `rpc.unavailable` while the location activates must not stick.
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => setCheckTick(n => n + 1), 2000);
    });
  });

  // Warn-once state for missing rows: activating the same row again opens it
  // anyway. Cleared on a timer and whenever the filter changes.
  let pendingTimer;
  const markPendingOpen = sessionID => {
    setPendingOpen(sessionID);
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => setPendingOpen(undefined), 5000);
  };
  onCleanup(() => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  });
  createEffect(() => {
    query();
    setPendingOpen(undefined);
  });

  // Click handler: open in tab (preferred) or navigate when tabs are off.
  //
  // A session whose directory is gone warns first: the toast is a plain,
  // dismissible notification (no `sessionID`, so the CLI does not attach its
  // "Open" action), and activating the same row again opens it anyway.
  const activate = (sessionID, directory) => {
    blurFilter();
    if (stale().get(directory) === false && pendingOpen() !== sessionID) {
      markPendingOpen(sessionID);
      context.ui.toast.show({
        message: "Directory missing — click again to open anyway",
        variant: "warning",
        duration: 3000
      });
      return;
    }
    setPendingOpen(undefined);
    if (context.ui.tabs.enabled()) {
      const list = context.ui.tabs.list();
      const existing = list.find(t => t.sessionID === sessionID);
      if (existing) {
        context.ui.tabs.focus(sessionID);
      } else {
        context.ui.tabs.open(sessionID);
        context.ui.tabs.focus(sessionID);
      }
      return;
    }
    context.ui.router.navigate({
      type: "session",
      sessionID
    });
  };

  // OpenTUI click idiom: mousedown highlights, mouseup fires the action.
  const onMouseDown = sessionID => setActiveRow(sessionID);
  const onMouseUp = (sessionID, directory) => activate(sessionID, directory);

  // Keymap: while the search field is focused, Enter opens the highlighted row
  // and the arrows move the highlight. Scoped to the field (`target`) so the
  // prompt keeps Enter, the arrows and "/" — an unscoped layer here would
  // intercept them and the prompt could not submit.
  context.keymap.layer(() => ({
    mode: "base",
    target: () => inputRef,
    priority: 1,
    commands: [{
      id: "session-history.activate",
      title: "Open highlighted session",
      bind: "return",
      enabled: () => {
        const id = activeRow();
        if (!id) return false;
        const session = sessions().find(s => s.id === id);
        return Boolean(session);
      },
      run: () => {
        const id = activeRow();
        if (!id) return;
        const session = sessions().find(s => s.id === id);
        if (!session) return;
        activate(session.id, session.location.directory);
      }
    }, {
      id: "session-history.move-down",
      title: "Move highlight down",
      bind: "down",
      run: () => {
        const rows = sessions();
        if (rows.length === 0) return;
        const i = rows.findIndex(s => s.id === activeRow());
        const next = i < 0 ? 0 : Math.min(i + 1, rows.length - 1);
        const row = rows[next];
        if (row) setActiveRow(row.id);
      }
    }, {
      id: "session-history.move-up",
      title: "Move highlight up",
      bind: "up",
      run: () => {
        const rows = sessions();
        if (rows.length === 0) return;
        const i = rows.findIndex(s => s.id === activeRow());
        const next = i < 0 ? rows.length - 1 : Math.max(i - 1, 0);
        const row = rows[next];
        if (row) setActiveRow(row.id);
      }
    }, {
      id: "session-history.filter.dismiss",
      title: "Clear session filter",
      bind: "escape",
      run: () => {
        if (query()) {
          setQuery("");
          return;
        }
        blurFilter();
      }
    }]
  }));
  return (() => {
    var _el$2 = _$createElement("box"),
      _el$3 = _$createElement("box"),
      _el$4 = _$createElement("text"),
      _el$6 = _$createElement("box"),
      _el$7 = _$createElement("input"),
      _el$8 = _$createElement("text");
    _$insertNode(_el$2, _el$3);
    _$setProp(_el$2, "flexDirection", "column");
    _$setProp(_el$2, "paddingX", 1);
    _$insertNode(_el$3, _el$4);
    _$insertNode(_el$3, _el$6);
    _$insertNode(_el$3, _el$8);
    _$setProp(_el$3, "flexDirection", "column");
    _$setProp(_el$3, "border", ["bottom"]);
    _$insertNode(_el$4, _$createTextNode(`Session History`));
    _$insertNode(_el$6, _el$7);
    _$use(el => {
      inputRef = el;
    }, _el$7);
    _$setProp(_el$7, "placeholder", "Search");
    _$setProp(_el$7, "onMouseDown", focusFilter);
    _$setProp(_el$7, "onInput", v => setQuery(v));
    _$insert(_el$8, summary);
    _$insert(_el$2, _$createComponent(Show, {
      get when() {
        return sessions().length > 0;
      },
      get fallback() {
        return (() => {
          var _el$0 = _$createElement("text");
          _$insert(_el$0, () => query() ? "No matches" : "No previous sessions");
          _$effect(_$p => _$setProp(_el$0, "fg", context.theme.text.muted, _$p));
          return _el$0;
        })();
      },
      get children() {
        var _el$9 = _$createElement("scrollbox");
        _$setProp(_el$9, "flexDirection", "column");
        _$setProp(_el$9, "maxHeight", 20);
        _$insert(_el$9, _$createComponent(For, {
          get each() {
            return sessions();
          },
          children: s => {
            const isStale = createMemo(() => stale().get(s.location.directory) === false);
            const isActive = createMemo(() => props.activeSessionID === s.id || activeRow() === s.id);
            const label = s.title?.trim() || `session ${s.id.slice(0, 8)}`;
            return (() => {
              var _el$1 = _$createElement("box"),
                _el$10 = _$createElement("text");
              _$insertNode(_el$1, _el$10);
              _$setProp(_el$1, "flexDirection", "column");
              _$setProp(_el$1, "border", ["bottom"]);
              _$setProp(_el$1, "onMouseDown", () => onMouseDown(s.id));
              _$setProp(_el$1, "onMouseUp", () => onMouseUp(s.id, s.location.directory));
              _$insert(_el$10, label, null);
              _$insert(_el$10, (() => {
                var _c$ = _$memo(() => !!isStale());
                return () => _c$() ? (() => {
                  var _el$13 = _$createElement("span");
                  _$insertNode(_el$13, _$createTextNode(` ✗ missing`));
                  _$effect(_$p => _$setProp(_el$13, "style", {
                    fg: context.theme.text.feedback.error.base
                  }, _$p));
                  return _el$13;
                })() : null;
              })(), null);
              _$insert(_el$1, _$createComponent(Show, {
                get when() {
                  return props.showMetrics;
                },
                get children() {
                  var _el$11 = _$createElement("text"),
                    _el$12 = _$createTextNode(` · $`);
                  _$insertNode(_el$11, _el$12);
                  _$insert(_el$11, (() => {
                    var _c$2 = _$memo(() => !!props.showAllProjects);
                    return () => _c$2() ? `${projectLabel(s.location.directory)} · ` : "";
                  })(), _el$12);
                  _$insert(_el$11, () => formatRelative(s.time.updated), _el$12);
                  _$insert(_el$11, () => s.cost.toFixed(2), null);
                  _$effect(_$p => _$setProp(_el$11, "fg", context.theme.text.muted, _$p));
                  return _el$11;
                }
              }), null);
              _$effect(_p$ => {
                var _v$12 = context.theme.border?.base,
                  _v$13 = isStale() ? context.theme.text.muted : isActive() ? context.theme.text.strong : context.theme.text.base;
                _v$12 !== _p$.e && (_p$.e = _$setProp(_el$1, "borderColor", _v$12, _p$.e));
                _v$13 !== _p$.t && (_p$.t = _$setProp(_el$10, "fg", _v$13, _p$.t));
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              return _el$1;
            })();
          }
        }));
        return _el$9;
      }
    }), null);
    _$effect(_p$ => {
      var _v$3 = props.align === "center" ? "100%" : undefined,
        _v$4 = props.align === "center" ? "center" : undefined,
        _v$5 = context.theme.border?.base,
        _v$6 = context.theme.text.strong,
        _v$7 = context.theme.background.formfield.base,
        _v$8 = context.theme.text.formfield.base,
        _v$9 = context.theme.background.formfield.focused,
        _v$0 = context.theme.text.formfield.focused,
        _v$1 = context.theme.text.formfield.focused,
        _v$10 = context.theme.text.muted,
        _v$11 = context.theme.text.feedback.warning.base;
      _v$3 !== _p$.e && (_p$.e = _$setProp(_el$2, "height", _v$3, _p$.e));
      _v$4 !== _p$.t && (_p$.t = _$setProp(_el$2, "justifyContent", _v$4, _p$.t));
      _v$5 !== _p$.a && (_p$.a = _$setProp(_el$3, "borderColor", _v$5, _p$.a));
      _v$6 !== _p$.o && (_p$.o = _$setProp(_el$4, "fg", _v$6, _p$.o));
      _v$7 !== _p$.i && (_p$.i = _$setProp(_el$7, "backgroundColor", _v$7, _p$.i));
      _v$8 !== _p$.n && (_p$.n = _$setProp(_el$7, "textColor", _v$8, _p$.n));
      _v$9 !== _p$.s && (_p$.s = _$setProp(_el$7, "focusedBackgroundColor", _v$9, _p$.s));
      _v$0 !== _p$.h && (_p$.h = _$setProp(_el$7, "focusedTextColor", _v$0, _p$.h));
      _v$1 !== _p$.r && (_p$.r = _$setProp(_el$7, "cursorColor", _v$1, _p$.r));
      _v$10 !== _p$.d && (_p$.d = _$setProp(_el$7, "placeholderColor", _v$10, _p$.d));
      _v$11 !== _p$.l && (_p$.l = _$setProp(_el$8, "fg", _v$11, _p$.l));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined
    });
    return _el$2;
  })();
}
function formatRelative(epoch) {
  if (!epoch) return "—";
  const diff = Date.now() - epoch;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}