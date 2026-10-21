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
import { directoryLabel, truncate } from "./text.js";
import { openSession } from "./navigation.js";
export function Inbox(props) {
  const context = usePlugin();
  const [selected, setSelected] = createSignal();
  const [width, setWidth] = createSignal(34);
  const [focused, setFocused] = createSignal(false);
  let box;
  let scroll;
  let previous = null;
  const focus = () => {
    // A tab/sidebar can be retained by the host while its layout is hidden.
    // Inspect only our own renderable, never the host's tree or breakpoint.
    if (!box || box.isDestroyed || !box.visible || box.width <= 0 || box.height <= 0 || box.screenX >= context.renderer.width || box.screenY >= context.renderer.height) return false;
    if (!box?.focused) previous = context.renderer.currentFocusedRenderable;
    box?.focus();
    setFocused(true);
    if (!selected()) setSelected(props.rows[0]?.session.id);
    return true;
  };
  const dismiss = () => {
    box?.blur();
    setFocused(false);
    if (previous && !previous.isDestroyed) previous.focus();
    previous = null;
  };
  props.registerFocus(focus);
  onCleanup(() => {
    props.registerFocus(undefined);
    if (box?.focused) dismiss();
  });
  createEffect(() => {
    const rows = props.rows;
    if (!rows.some(row => row.session.id === selected())) setSelected(rows[0]?.session.id);
    const id = selected();
    if (id) scroll?.scrollChildIntoView(`attention-inbox-${id}`);
  });
  const activate = row => {
    dismiss();
    openSession(context, row);
    // Native route rendering owns session.view and its exact idle token. Merely
    // mounting this inbox or opening a background tab never acknowledges it.
  };
  const move = delta => {
    const index = props.rows.findIndex(row => row.session.id === selected());
    const row = props.rows[Math.max(0, Math.min(props.rows.length - 1, index + delta))];
    if (row) setSelected(row.session.id);
  };
  context.keymap.layer(() => ({
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
  const health = createMemo(() => {
    if (props.scope === "project" && !props.projectKnown) return "Resolving current project...";
    switch (props.snapshot.phase) {
      case "syncing":
        return "Syncing...";
      case "partial":
        return "Partial · still checking";
      case "stale":
        return "Stale · refresh to retry";
      case "ready":
        return props.rows.length ? "" : "Nothing needs attention";
    }
  });
  const measure = () => setWidth(Math.max(0, scroll?.viewport.width ?? (box?.width ?? 36) - 2));
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
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
    _$insert(_el$2, () => truncate(`Needs attention  ${props.rows.length}${props.snapshot.phase !== "ready" ? " · ?" : ""}`, width()));
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
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return props.rows.length;
      },
      get children() {
        var _el$5 = _$createElement("scrollbox");
        _$use(value => {
          scroll = value;
          measure();
        }, _el$5);
        _$setProp(_el$5, "onSizeChange", measure);
        _$setProp(_el$5, "flexShrink", 1);
        _$insert(_el$5, _$createComponent(For, {
          get each() {
            return props.rows;
          },
          children: row => {
            const active = () => selected() === row.session.id && focused();
            return (() => {
              var _el$7 = _$createElement("box"),
                _el$8 = _$createElement("text"),
                _el$9 = _$createElement("text"),
                _el$0 = _$createElement("text");
              _$insertNode(_el$7, _el$8);
              _$insertNode(_el$7, _el$9);
              _$insertNode(_el$7, _el$0);
              _$setProp(_el$7, "flexDirection", "column");
              _$setProp(_el$7, "height", 3);
              _$setProp(_el$7, "flexShrink", 0);
              _$setProp(_el$7, "onMouseDown", event => {
                if (event.button === 0) {
                  focus();
                  setSelected(row.session.id);
                }
              });
              _$setProp(_el$7, "onMouseUp", event => {
                if (event.button === 0) activate(row);
              });
              _$setProp(_el$8, "wrapMode", "none");
              _$insert(_el$8, () => truncate(`${active() ? "› " : ""}${row.session.title?.trim() || "Untitled session"}`, width()));
              _$setProp(_el$9, "wrapMode", "none");
              _$insert(_el$9, () => truncate(statusLabel(row), width()));
              _$setProp(_el$0, "wrapMode", "none");
              _$insert(_el$0, () => truncate(`${directoryLabel(row.session.location.directory)}${row.session.parentID ? ` · child of ${row.parentTitle ?? row.session.parentID}` : ""}`, width()));
              _$effect(_p$ => {
                var _v$4 = `attention-inbox-${row.session.id}`,
                  _v$5 = active() ? context.theme.text.strong : context.theme.text.base,
                  _v$6 = context.theme.text.feedback.warning.base,
                  _v$7 = context.theme.text.muted;
                _v$4 !== _p$.e && (_p$.e = _$setProp(_el$7, "id", _v$4, _p$.e));
                _v$5 !== _p$.t && (_p$.t = _$setProp(_el$8, "fg", _v$5, _p$.t));
                _v$6 !== _p$.a && (_p$.a = _$setProp(_el$9, "fg", _v$6, _p$.a));
                _v$7 !== _p$.o && (_p$.o = _$setProp(_el$0, "fg", _v$7, _p$.o));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined,
                o: undefined
              });
              return _el$7;
            })();
          }
        }));
        _$effect(_$p => _$setProp(_el$5, "maxHeight", props.maxVisibleRows * 3, _$p));
        return _el$5;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return focused();
      },
      get children() {
        var _el$6 = _$createElement("text");
        _$setProp(_el$6, "wrapMode", "none");
        _$insert(_el$6, () => truncate("↑↓ select · Enter open · Esc back", width()));
        _$effect(_$p => _$setProp(_el$6, "fg", context.theme.text.muted, _$p));
        return _el$6;
      }
    }), null);
    _$effect(_p$ => {
      var _v$ = context.theme.border.base,
        _v$2 = context.theme.text.strong,
        _v$3 = context.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "borderColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$3, "fg", _v$3, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}