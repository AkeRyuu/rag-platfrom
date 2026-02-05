/**
 * Shared formatters and content helpers for tool output.
 */

/** Content preview length constants */
export const PREVIEW = {
  SHORT: 100,
  MEDIUM: 300,
  LONG: 500,
  FULL: 800,
} as const;

/** Truncate text to max length with ellipsis */
export function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + "...";
}

/** Format a score as percentage */
export function pct(score: number): string {
  return (score * 100).toFixed(1) + "%";
}

/** Format code search results into markdown */
export function formatCodeResults(
  results: Array<{ file: string; content: string; score: number; language?: string; startLine?: number; endLine?: number }>,
  contentLimit: number = PREVIEW.LONG
): string {
  if (!results || results.length === 0) return "No results found.";
  return results
    .map(
      (r) =>
        `**${r.file}** (${pct(r.score)} match)\n` +
        (r.startLine ? `Lines ${r.startLine}-${r.endLine || "?"}\n` : "") +
        "```" + (r.language || "") + "\n" +
        truncate(r.content, contentLimit) +
        "\n```"
    )
    .join("\n\n---\n\n");
}

/** Format memory results into markdown */
export function formatMemoryResults(
  results: Array<{ memory: Record<string, unknown>; score: number }>,
  emptyMessage = "No memories found."
): string {
  if (!results || results.length === 0) return emptyMessage;

  const typeEmojis: Record<string, string> = {
    decision: "🎯",
    insight: "💡",
    context: "📌",
    todo: "📋",
    conversation: "💬",
    note: "📝",
  };

  let result = "";
  results.forEach((r, i) => {
    const m = r.memory;
    const type = m.type as string;
    const emoji = type === "todo" && m.status === "done" ? "✅" : (typeEmojis[type] || "📝");

    result += `### ${i + 1}. ${emoji} ${(type || "note").toUpperCase()}\n`;
    result += `**Relevance:** ${pct(r.score)}\n`;
    result += `${m.content}\n`;
    if (m.relatedTo) result += `*Related to: ${m.relatedTo}*\n`;
    if ((m.tags as string[])?.length > 0) result += `*Tags: ${(m.tags as string[]).join(", ")}*\n`;
    if (m.status) result += `*Status: ${m.status}*\n`;
    result += `*${new Date(m.createdAt as string).toLocaleDateString()}*\n\n`;
  });

  return result;
}

/** Format a simple list of files with scores */
export function formatFileList(
  files: Array<{ file: string; score?: number }>,
  emptyMessage = "No files found."
): string {
  if (!files || files.length === 0) return emptyMessage;
  return files
    .map((f) => `- ${f.file}${f.score ? ` (${pct(f.score)})` : ""}`)
    .join("\n");
}
