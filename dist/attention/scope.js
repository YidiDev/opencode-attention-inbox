/** Longest path-boundary match handles launch subdirectories and project worktrees. */
export function projectForDirectory(directory, projects) {
  let match;
  for (const project of projects) {
    for (const candidate of [project.canonical, ...project.sandboxes]) {
      const root = candidate.replace(/\/+$/, "") || "/";
      if ((directory === root || directory.startsWith(root === "/" ? "/" : `${root}/`)) && (!match || root.length > match.length)) match = {
        id: project.id,
        length: root.length
      };
    }
  }
  return match?.id;
}