const relevant = new Set(["server.connected", "location.shutdown", "session.created", "session.deleted", "session.renamed", "session.moved", "session.archived", "session.unarchived", "session.viewed", "session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.status.updated", "session.idle", "permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled"]);
export function createAdapter(context) {
  const client = context.client;
  return {
    async sessions(cursor, signal) {
      const page = await client.session.list({
        limit: 100,
        order: "desc",
        ...(cursor ? {
          cursor
        } : {})
      }, {
        signal
      });
      return {
        data: page.data.map(({
          id,
          parentID,
          projectID,
          title,
          location,
          outcome,
          time
        }) => ({
          id,
          parentID,
          projectID,
          title,
          location: {
            directory: location.directory
          },
          outcome,
          time: {
            created: time.created,
            updated: time.updated,
            idle: time.idle,
            viewed: time.viewed,
            archived: time.archived
          }
        })),
        next: page.cursor.next ?? undefined
      };
    },
    async pending(directory, signal) {
      const siblings = new AbortController();
      const combined = AbortSignal.any([signal, siblings.signal]);
      try {
        const [permissions, questions] = await Promise.all([client.permission.request.list({
          location: {
            directory
          }
        }, {
          signal: combined
        }), client.form.list({
          location: {
            directory
          }
        }, {
          signal: combined
        })]);
        // Drop payloads immediately; neither the controller nor storage needs them.
        const identity = ({
          id,
          sessionID
        }) => ({
          id,
          sessionID
        });
        return {
          permissions: permissions.data.map(identity),
          questions: questions.data.map(identity)
        };
      } finally {
        // A failed half must not leave its sibling running behind the next scan.
        siblings.abort();
      }
    },
    async active(signal) {
      return new Set(Object.keys(await client.session.active({
        signal
      })));
    },
    listen(handler) {
      return context.data.listen(({
        details
      }) => {
        if (!relevant.has(details.type)) return;
        if (details.type === "permission.asked" || details.type === "form.created") {
          handler({
            request: {
              id: details.type === "permission.asked" ? details.data.id : details.data.form.id,
              kind: details.type === "permission.asked" ? "permission" : "question",
              created: details.created
            }
          });
        } else handler({});
      });
    }
  };
}