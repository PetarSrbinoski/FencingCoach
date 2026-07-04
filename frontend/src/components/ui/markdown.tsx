"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Shared renderer for AI-generated prose (coach chat replies, daily brief,
// mental-training insight, nutrition notes, etc). Backend prompts ask the
// model for structure (headings, bullet lists, bold labels) but the raw
// text was previously dumped verbatim — this parses it as Markdown and
// styles it to match the app's sharp-corner, hairline-border aesthetic
// instead of pulling in the Tailwind typography plugin.
const components: Components = {
  // `white-space: pre-line` matters here: a single `\n` inside a
  // CommonMark paragraph is a "soft break" — remark keeps it as a
  // literal newline character in the text node (it does NOT collapse it
  // to a space), but default HTML whitespace handling then collapses it
  // visually. Prompts like DAILY_BRIEF_PROMPT rely on single-newline
  // separated labeled lines (READINESS:/TODAY:/etc.) actually rendering
  // as separate lines, not one run-on paragraph.
  p: ({ children }) => <p className="mb-3 whitespace-pre-line last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 last:mb-0 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 last:mb-0 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-bold tracking-tight first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-4 text-xs font-bold uppercase tracking-widest text-muted-foreground first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-accent"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-accent pl-3 text-foreground/70 italic last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto border border-border bg-muted p-3 font-mono text-xs last:mb-0">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    // Fenced code blocks carry a `language-*` class from remark; inline
    // `code` spans don't — style each case differently.
    const isBlock = /language-/.test(className || "");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-xs", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border pb-1.5 pr-3 text-left text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border py-1.5 pr-3 align-top">{children}</td>,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
