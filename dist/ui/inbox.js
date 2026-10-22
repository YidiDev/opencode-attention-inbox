import { memo as _$memo } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui";
import { RenderableEvents } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { statusLabel } from "../attention/derive.js";
import { openSession } from "./navigation.js";
import { inboxHealth, rowIndicator, rowTitle, rowWindow } from "./presentation.js";
import { safeText, truncate } from "./text.js";
export function Inbox(props) {
  const context = usePlugin();
  const [selected, setSelected] = createSignal();
  const [width, setWidth] = createSignal(34);
  const [focused, setFocused] = createSignal(false);
  const [hovered, setHovered] = createSignal();
  const [scrollTop, setScrollTop] = createSignal(0);
  const byID = createMemo(() => new Map(props.rows.map(row => [row.session.id, row])));
  const disambiguation = createMemo(() => {
    const titles = new Map();
    for (const row of props.rows) {
      const title = safeText(row.session.title?.trim() || "Untitled session");
      titles.set(title, (titles.get(title) ?? 0) + 1);
    }
    return titles;
  });
  const window = createMemo(() => rowWindow(props.rows.map(row => row.session.id), scrollTop(), props.maxVisibleRows));
  let box;
  let scroll;
  let previous = null;
  let pressedID;
  const focus = (reveal = true) => {
    // A tab/sidebar can be retained by the host while its layout is hidden.
    // Inspect only our own renderable, never the host's tree or breakpoint.
    if (!box || box.isDestroyed || !box.visible || box.width <= 0 || box.height <= 0 || box.screenX >= context.renderer.width || box.screenY >= context.renderer.height) return false;
    if (!box?.focused) previous = context.renderer.currentFocusedRenderable;
    box?.focus();
    setFocused(true);
    if (!selected()) setSelected(props.rows[0]?.session.id);
    if (reveal) revealSelection();
    return true;
  };
  const dismiss = () => {
    pressedID = undefined;
    box?.blur();
    setFocused(false);
    if (previous && !previous.isDestroyed) previous.focus();
    previous = null;
  };
  const unregisterFocus = props.registerFocus(focus);
  onCleanup(() => {
    unregisterFocus();
    if (box?.focused) dismiss();
  });
  createEffect(() => {
    const rows = props.rows;
    if (!rows.some(row => row.session.id === selected())) setSelected(rows[0]?.session.id);
  });
  const syncScroll = () => setScrollTop(scroll?.scrollTop ?? 0);
  function revealSelection() {
    const index = props.rows.findIndex(row => row.session.id === selected());
    if (!scroll || index < 0) return;
    const top = index;
    const height = scroll.viewport.height || props.maxVisibleRows;
    if (top < scroll.scrollTop) scroll.scrollTo(top);else if (top + 1 > scroll.scrollTop + height) scroll.scrollTo(top + 1 - height);
    syncScroll();
  }
  const activate = row => {
    dismiss();
    openSession(context, row);
    // Native route rendering owns session.view and its exact idle token. Merely
    // mounting this inbox or opening a background tab never acknowledges it.
  };
  const move = delta => {
    const index = props.rows.findIndex(row => row.session.id === selected());
    const row = props.rows[Math.max(0, Math.min(props.rows.length - 1, index + delta))];
    if (row) {
      setSelected(row.session.id);
      revealSelection();
    }
  };
  context.keymap.layer(() => ({
    mode: "global",
    target: () => box,
    priority: 10,
    commands: [{
      id: "attention-inbox.move-down",
      bind: "down",
      run: () => move(1)
    }, {
      id: "attention-inbox.move-up",
      bind: "up",
      run: () => move(-1)
    }, {
      id: "attention-inbox.activate",
      bind: "return",
      run: () => {
        const row = props.rows.find(row => row.session.id === selected());
        if (row) activate(row);
      }
    }, {
      id: "attention-inbox.dismiss",
      bind: "escape",
      run: dismiss
    }, {
      id: "attention-inbox.scope.local",
      bind: "tab",
      run: props.toggleScope
    }]
  }));
  const health = () => inboxHealth(props.snapshot.phase, props.rows.length, props.scope, props.projectKnown);
  const footer = () => {
    if (focused()) return "↑↓ select · Enter open · Esc back";
    const id = hovered();
    const row = id ? byID().get(id) : undefined;
    return row ? statusLabel(row) : "";
  };
  const measure = () => {
    const viewport = scroll && !scroll.isDestroyed ? scroll.viewport.width : 0;
    setWidth(Math.max(1, viewport || (box?.width ?? 36) - 2));
  };
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("text"),
      _el$8 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$insertNode(_el$, _el$8);
    _$use(value => {
      box = value;
      const onBlur = () => setFocused(false);
      value.on(RenderableEvents.BLURRED, onBlur);
      onCleanup(() => value.off(RenderableEvents.BLURRED, onBlur));
    }, _el$);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "flexShrink", 1);
    _$setProp(_el$, "focusable", true);
    _$setProp(_el$, "border", ["top"]);
    _$setProp(_el$, "paddingTop", 1);
    _$setProp(_el$, "onSizeChange", measure);
    _$setProp(_el$2, "onMouseUp", event => {
      if (event.button === 0) focus();
    });
    _$setProp(_el$2, "wrapMode", "none");
    _$insert(_el$2, () => truncate(`Needs attention  ${props.rows.length}${props.snapshot.phase !== "ready" || props.scope === "project" && !props.projectKnown ? " · ?" : ""}`, width()));
    _$setProp(_el$3, "wrapMode", "none");
    _$setProp(_el$3, "onMouseUp", event => {
      if (event.button === 0) props.toggleScope();
    });
    _$insert(_el$3, () => truncate(`${props.scope === "all" ? "All projects" : "Current project"} ↔`, width()));
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return health();
      },
      get children() {
        var _el$4 = _$createElement("text");
        _$setProp(_el$4, "wrapMode", "none");
        _$insert(_el$4, () => truncate(health(), width()));
        _$effect(_$p => _$setProp(_el$4, "fg", context.theme.text.muted, _$p));
        return _el$4;
      }
    }), _el$8);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return props.rows.length;
      },
      get children() {
        var _el$5 = _$createElement("scrollbox"),
          _el$6 = _$createElement("box"),
          _el$7 = _$createElement("box");
        _$insertNode(_el$5, _el$6);
        _$insertNode(_el$5, _el$7);
        _$use(value => {
          scroll = value;
          measure();
          value.verticalScrollBar.on("change", syncScroll);
          onCleanup(() => value.verticalScrollBar.off("change", syncScroll));
        }, _el$5);
        _$setProp(_el$5, "onSizeChange", () => {
          measure();
          syncScroll();
        });
        _$setProp(_el$5, "onMouseScroll", () => queueMicrotask(syncScroll));
        _$setProp(_el$5, "flexShrink", 1);
        _$setProp(_el$6, "flexShrink", 0);
        _$insert(_el$5, _$createComponent(For, {
          get each() {
            return window().ids;
          },
          children: id => {
            const row = () => byID().get(id);
            const indicator = () => {
              const current = row();
              return current ? rowIndicator(current) : "";
            };
            const label = () => {
              const current = row();
              if (!current) return "";
              const title = safeText(current.session.title?.trim() || "Untitled session");
              return rowTitle(current, Math.max(0, width() - Bun.stringWidth(indicator()) - 5), (disambiguation().get(title) ?? 0) > 1);
            };
            const active = () => selected() === id && focused();
            const states = () => ({
              hovered: hovered() === id,
              selected: active(),
              focused: active()
            });
            onCleanup(() => {
              if (hovered() === id) setHovered(undefined);
            });
            return (// biome-ignore lint/a11y/useKeyWithMouseEvents: Native list keyboard focus is on the parent; hover must never focus a row.
              (() => {
                var _el$9 = _$createElement("box"),
                  _el$0 = _$createElement("text"),
                  _el$1 = _$createElement("span");
                _$insertNode(_el$9, _el$0);
                _$setProp(_el$9, "id", `attention-inbox-${id}`);
                _$setProp(_el$9, "flexDirection", "row");
                _$setProp(_el$9, "height", 1);
                _$setProp(_el$9, "flexShrink", 0);
                _$setProp(_el$9, "width", "100%");
                _$setProp(_el$9, "paddingLeft", 1);
                _$setProp(_el$9, "paddingRight", 1);
                _$setProp(_el$9, "onMouseOver", () => setHovered(id));
                _$setProp(_el$9, "onMouseOut", () => setHovered(undefined));
                _$setProp(_el$9, "onMouseDown", event => {
                  if (event.button === 0) {
                    pressedID = id;
                    setSelected(id);
                    // Pointer focus must not move virtualized content under the pointer.
                    focus(false);
                  }
                });
                _$setProp(_el$9, "onMouseUp", event => {
                  if (event.button !== 0) return;
                  const pressed = pressedID;
                  pressedID = undefined;
                  const current = row();
                  // A reorder/removal between press and release cancels the click.
                  if (pressed === id && current) activate(current);
                });
                _$insertNode(_el$0, _el$1);
                _$setProp(_el$0, "wrapMode", "none");
                _$insert(_el$0, () => active() ? "› " : "  ", _el$1);
                _$insert(_el$1, indicator);
                _$insert(_el$0, () => ` ${label()}`, null);
                _$effect(_p$ => {
                  var _v$8 = context.theme.background.action.secondary.state(states()),
                    _v$9 = context.theme.text.action.secondary.state(states()),
                    _v$0 = {
                      fg: row()?.permissions ? context.theme.text.feedback.warning.base : context.theme.text.feedback.info.base
                    };
                  _v$8 !== _p$.e && (_p$.e = _$setProp(_el$9, "backgroundColor", _v$8, _p$.e));
                  _v$9 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$9, _p$.t));
                  _v$0 !== _p$.a && (_p$.a = _$setProp(_el$1, "style", _v$0, _p$.a));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined
                });
                return _el$9;
              })()
            );
          }
        }), _el$7);
        _$setProp(_el$7, "flexShrink", 0);
        _$effect(_p$ => {
          var _v$ = props.maxVisibleRows,
            _v$2 = window().before,
            _v$3 = window().after;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$5, "maxHeight", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "height", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp(_el$7, "height", _v$3, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$5;
      }
    }), _el$8);
    _$setProp(_el$8, "height", 1);
    _$setProp(_el$8, "wrapMode", "none");
    _$insert(_el$8, () => truncate(footer(), width()));
    _$effect(_p$ => {
      var _v$4 = context.theme.border.base,
        _v$5 = context.theme.text.base,
        _v$6 = context.theme.text.muted,
        _v$7 = context.theme.text.muted;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$, "borderColor", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp(_el$3, "fg", _v$6, _p$.a));
      _v$7 !== _p$.o && (_p$.o = _$setProp(_el$8, "fg", _v$7, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}