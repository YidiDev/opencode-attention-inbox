/** The host resolves the session's own location. Never substitute the current directory. */
export function openSession(context, row) {
  const id = row.session.id;
  if (context.ui.tabs.enabled()) {
    if (!context.ui.tabs.focus(id)) context.ui.router.navigate({
      type: "session",
      sessionID: id
    });
    // Tabs are root-session tabs; retain the exact child that owns the request.
    else if (row.session.parentID) context.ui.router.navigate({
      type: "session",
      sessionID: id
    });
  } else context.ui.router.navigate({
    type: "session",
    sessionID: id
  });
}