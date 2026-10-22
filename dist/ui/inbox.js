import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui";
import { RenderableEvents } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
  const [keyTarget, setKeyTarget] = createSignal();
  let scroll;
  let previous = null;
  let pressedID;
  const focus = (reveal = true) => {
    // A tab/sidebar can be retained by the host while its layout is hidden.
    // Inspect only our own renderable, never the host's tree or breakpoint.
    if (props.rows.length === 0 || !box || box.isDestroyed || !box.visible || box.width <= 0 || box.height <= 0 || box.screenX >= context.renderer.width || box.screenY >= context.renderer.height) return false;
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
    if (!rows.length && focused()) dismiss();
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
    target: keyTarget,
    priority: 10,
    commands: keyTarget() ? [{
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
    }] : []
  }));
  const health = () => props.snapshot.phase === "partial" || props.snapshot.phase === "stale" || props.snapshot.phase === "ready" && props.scope === "project" && !props.projectKnown ? inboxHealth(props.snapshot.phase, props.rows.length, props.scope, props.projectKnown) : "";
  const measure = () => {
    const viewport = scroll && !scroll.isDestroyed ? scroll.viewport.width : 0;
    const available = viewport || box?.width || 0;
    if (available > 0) setWidth(available);
  };
  return _$createComponent(Show, {
    get when() {
      return props.rows.length || health();
    },
    get children() {
      var _el$ = _$createElement("box");
      _$use(value => {
        box = value;
        setKeyTarget(value);
        const onBlur = () => setFocused(false);
        value.on(RenderableEvents.BLURRED, onBlur);
        onCleanup(() => value.off(RenderableEvents.BLURRED, onBlur));
        onCleanup(() => {
          if (box === value) {
            // The renderer may blur a removed node before reactive effects run.
            // Restore the saved input only if removal left no other focus owner.
            const current = context.renderer.currentFocusedRenderable;
            if (previous && !previous.isDestroyed && (!current || current === value)) previous.focus();
            previous = null;
            setFocused(false);
            box = undefined;
            setKeyTarget(undefined);
          }
        });
      }, _el$);
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "flexShrink", 1);
      _$setProp(_el$, "focusable", true);
      _$setProp(_el$, "onSizeChange", measure);
      _$insert(_el$, _$createComponent(Show, {
        get when() {
          return health();
        },
        get children() {
          var _el$2 = _$createElement("text");
          _$setProp(_el$2, "wrapMode", "none");
          _$insert(_el$2, () => truncate(health(), width()));
          _$effect(_$p => _$setProp(_el$2, "fg", context.theme.text.muted, _$p));
          return _el$2;
        }
      }), null);
      _$insert(_el$, _$createComponent(Show, {
        get when() {
          return props.rows.length;
        },
        get children() {
          var _el$3 = _$createElement("scrollbox"),
            _el$4 = _$createElement("box"),
            _el$5 = _$createElement("box");
          _$insertNode(_el$3, _el$4);
          _$insertNode(_el$3, _el$5);
          _$use(value => {
            scroll = value;
            measure();
            value.verticalScrollBar.on("change", syncScroll);
            onCleanup(() => value.verticalScrollBar.off("change", syncScroll));
            onCleanup(() => {
              if (scroll === value) scroll = undefined;
            });
          }, _el$3);
          _$setProp(_el$3, "onSizeChange", () => {
            measure();
            syncScroll();
          });
          _$setProp(_el$3, "onMouseScroll", () => queueMicrotask(syncScroll));
          _$setProp(_el$3, "flexShrink", 1);
          _$setProp(_el$4, "flexShrink", 0);
          _$insert(_el$3, _$createComponent(For, {
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
                  var _el$6 = _$createElement("box"),
                    _el$7 = _$createElement("text"),
                    _el$8 = _$createElement("span");
                  _$insertNode(_el$6, _el$7);
                  _$setProp(_el$6, "id", `attention-inbox-${id}`);
                  _$setProp(_el$6, "flexDirection", "row");
                  _$setProp(_el$6, "height", 1);
                  _$setProp(_el$6, "flexShrink", 0);
                  _$setProp(_el$6, "width", "100%");
                  _$setProp(_el$6, "paddingLeft", 1);
                  _$setProp(_el$6, "paddingRight", 1);
                  _$setProp(_el$6, "onMouseOver", () => setHovered(id));
                  _$setProp(_el$6, "onMouseOut", () => setHovered(undefined));
                  _$setProp(_el$6, "onMouseDown", event => {
                    if (event.button === 0) {
                      pressedID = id;
                      setSelected(id);
                      // Pointer focus must not move virtualized content under the pointer.
                      focus(false);
                    }
                  });
                  _$setProp(_el$6, "onMouseUp", event => {
                    if (event.button !== 0) return;
                    const pressed = pressedID;
                    pressedID = undefined;
                    const current = row();
                    // A reorder/removal between press and release cancels the click.
                    if (pressed === id && current) activate(current);
                  });
                  _$insertNode(_el$7, _el$8);
                  _$setProp(_el$7, "wrapMode", "none");
                  _$insert(_el$7, () => active() ? "› " : "  ", _el$8);
                  _$insert(_el$8, indicator);
                  _$insert(_el$7, () => ` ${label()}`, null);
                  _$effect(_p$ => {
                    var _v$5 = context.theme.background.action.secondary.state(states()),
                      _v$6 = context.theme.text.action.secondary.state(states()),
                      _v$7 = {
                        fg: row()?.permissions ? context.theme.text.feedback.warning.base : context.theme.text.feedback.info.base
                      };
                    _v$5 !== _p$.e && (_p$.e = _$setProp(_el$6, "backgroundColor", _v$5, _p$.e));
                    _v$6 !== _p$.t && (_p$.t = _$setProp(_el$7, "fg", _v$6, _p$.t));
                    _v$7 !== _p$.a && (_p$.a = _$setProp(_el$8, "style", _v$7, _p$.a));
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined,
                    a: undefined
                  });
                  return _el$6;
                })()
              );
            }
          }), _el$5);
          _$setProp(_el$5, "flexShrink", 0);
          _$effect(_p$ => {
            var _v$ = props.maxVisibleRows,
              _v$2 = Math.min(props.rows.length, props.maxVisibleRows),
              _v$3 = window().before,
              _v$4 = window().after;
            _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "maxHeight", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "height", _v$2, _p$.t));
            _v$3 !== _p$.a && (_p$.a = _$setProp(_el$4, "height", _v$3, _p$.a));
            _v$4 !== _p$.o && (_p$.o = _$setProp(_el$5, "height", _v$4, _p$.o));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined,
            o: undefined
          });
          return _el$3;
        }
      }), null);
      return _el$;
    }
  });
}