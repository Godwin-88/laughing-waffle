import type { LessonPublic } from "@takwimu/shared";

/**
 * Compact markdown renderer for lesson content.
 * Supports the subset used by Takwimu lesson notebooks: ATX headings,
 * fenced code blocks, blockquotes, ordered/unordered lists, tables,
 * horizontal rules, and inline bold/italic/inline-code. HTML is escaped.
 */
export function MarkdownView({ lesson }: { lesson: LessonPublic }) {
  try {
    return <div className="space-y-4 text-ink-800">{blocks(lesson.content).map(renderBlock)}</div>;
  } catch {
    return (
      <div className="whitespace-pre-wrap font-mono text-sm text-ink-800">{lesson.content}</div>
    );
  }
}

interface Block {
  type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "table" | "quote" | "code" | "hr";
  raw: string;
  rows?: string[][];
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

/** Renders inline markdown (**bold**, *italic*, `code`) to React nodes. */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter((t) => t !== "");
  let key = 0;
  for (const tok of tokens) {
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      out.push(<strong key={key++} className="font-semibold text-ink-900">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      out.push(<code key={key++} className="rounded bg-ink-100 px-1 font-mono text-[13px] text-brand-700">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      out.push(<em key={key++} className="italic text-ink-700">{tok.slice(1, -1)}</em>);
    } else {
      out.push(<span key={key++}>{escapeHtml(tok)}</span>);
    }
  }
  return out;
}
function blocks(md: string): Block[] {
  const lines = md.replaceAll("\r\n", "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push({ type: "code", raw: code.join("\n") });
      continue;
    }

    if (trimmed.startsWith("### ")) out.push({ type: "h3", raw: trimmed.slice(4) });
    else if (trimmed.startsWith("## ")) out.push({ type: "h2", raw: trimmed.slice(3) });
    else if (trimmed.startsWith("# ")) out.push({ type: "h1", raw: trimmed.slice(2) });
    else if (/^---+$/.test(trimmed)) out.push({ type: "hr", raw: "" });
    else if (trimmed.startsWith("> ")) {
      const quoteRows: string[] = [trimmed.slice(2)];
      i++;
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quoteRows.push(lines[i].trimStart().slice(2));
        i++;
      }
      i--;
      out.push({ type: "quote", raw: quoteRows.join("\n") });
    } else if (trimmed.startsWith("|")) {
      if (!/^\|?\s*:?-{2,}\s*\|/.test(trimmed)) {
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trimStart().startsWith("|")) {
          const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        out.push({ type: "table", raw: "", rows });
        continue;
      }
      out.push({ type: "p", raw: trimmed });
    } else if (/^\s*[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].trim().slice(2).trim());
        i++;
      }
      i--;
      out.push({ type: "ul", raw: items.join("\n") });
    } else if (/^\s*\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      i--;
      out.push({ type: "ol", raw: items.join("\n") });
    } else if (trimmed === "") {
      out.push({ type: "p", raw: " " });
    } else {
      out.push({ type: "p", raw: trimmed });
    }
    i++;
  }
  return out;
}
function renderBlock(block: Block) {
  switch (block.type) {
    case "h1":
      return <h1 key={block.raw} className="text-3xl font-extrabold tracking-tight text-ink-900">{inline(block.raw)}</h1>;
    case "h2":
      return <h2 key={block.raw} className="mt-2 text-2xl font-bold text-ink-900">{inline(block.raw)}</h2>;
    case "h3":
      return <h3 key={block.raw} className="mt-1 text-xl font-semibold text-ink-900">{inline(block.raw)}</h3>;
    case "p":
      return block.raw === " " ? <div key={block.raw} className="h-4" /> : (
        <p key={block.raw} className="text-[15px] leading-7">{inline(block.raw)}</p>
      );
    case "ul":
      return (
        <ul key={block.raw} className="list-disc space-y-1 pl-5 text-[15px] leading-7">
          {block.raw.split("\n").map((item, idx) => (
            <li key={idx}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={block.raw} className="list-decimal space-y-1 pl-5 text-[15px] leading-7">
          {block.raw.split("\n").map((item, idx) => (
            <li key={idx}>{inline(item)}</li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote key={block.raw} className="border-l-4 border-brand-200 bg-brand-50 px-4 py-2 text-[15px] text-brand-800">
          {block.raw.split("\n").map((l, idx) => (
            <p key={idx} className="leading-7">{inline(l)}</p>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={block.raw} className="overflow-x-auto rounded-lg border border-ink-200 bg-ink-900 p-4 font-mono text-sm leading-6 text-ink-100">
          {block.raw.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}
        </pre>
      );
    case "table": {
      const rows = block.rows ?? [];
      return (
        <table key={String(rows.length)} className="w-full border-collapse text-sm">
          {rows.map((row, ri) => (
            <tr key={ri} className={ri === 0 ? "bg-ink-100" : "border-t border-ink-200"}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-ink-200 px-3 py-1.5 text-left">{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </table>
      );
    }
    case "hr":
      return <hr key={Math.random()} className="border-ink-200" />;
  }
}