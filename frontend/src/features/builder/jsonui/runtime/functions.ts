function getTodoItems(args: Record<string, unknown>) {
  return Array.isArray(args.items) ? args.items : [];
}

export const builderRuntimeFunctions = {
  todo_summary(args: Record<string, unknown>) {
    const items = getTodoItems(args);
    const completed = items.filter((item) => typeof item === 'object' && item !== null && (item as { completed?: boolean }).completed).length;
    const filter = typeof args.filter === 'string' ? args.filter : 'all';

    return `${items.length} tasks in preview, ${completed} completed, filter: ${filter}.`;
  },
  summary_detail(args: Record<string, unknown>) {
    const items = getTodoItems(args);
    const completed = items.filter((item) => typeof item === 'object' && item !== null && (item as { completed?: boolean }).completed).length;
    const open = Math.max(items.length - completed, 0);

    return `This screen is generated from JSON. You currently have ${open} open items and ${completed} completed items.`;
  },
};
