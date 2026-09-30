/**
 * Renders a markdown body or comment (#36) from the tree in markdown.ts as
 * React elements: text is always escaped by React, no HTML is injected,
 * links open in a new tab without a referrer or opener, and images are
 * links, never loaded.
 */
import { type ReactNode, useMemo } from "react";
import { type Block, type Inline, parseMarkdown } from "./markdown.ts";

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      referrerPolicy="no-referrer"
    >
      {children}
    </a>
  );
}

function inlines(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    const key = i;
    switch (n.t) {
      case "text":
        return n.v;
      case "br":
        return <br key={key} />;
      case "code":
        return <code key={key}>{n.v}</code>;
      case "strong":
        return <strong key={key}>{inlines(n.c)}</strong>;
      case "em":
        return <em key={key}>{inlines(n.c)}</em>;
      case "del":
        return <del key={key}>{inlines(n.c)}</del>;
      case "link":
        return (
          <Link key={key} href={n.href}>
            {inlines(n.c)}
          </Link>
        );
      case "image": {
        const label = `Image: ${n.alt || "untitled"}`;
        return n.href ? (
          <Link key={key} href={n.href}>
            <span className="rg-md__image">{label}</span>
          </Link>
        ) : (
          <span key={key} className="rg-md__image">
            {label}
          </span>
        );
      }
      default:
        return null;
    }
  });
}

/** A list item that is one paragraph (the usual case) renders inline, without a <p>. */
function tight(nodes: readonly Block[]): ReactNode[] {
  const [first, ...rest] = nodes;
  if (first?.t !== "p") return blocks(nodes);
  return [...inlines(first.c), ...blocks(rest)];
}

function blocks(nodes: readonly Block[]): ReactNode[] {
  return nodes.map((b, i) => {
    const key = i;
    switch (b.t) {
      case "p":
        return <p key={key}>{inlines(b.c)}</p>;
      case "h": {
        // Card titles are the panel's h2; body headings sit below them.
        const Tag = `h${Math.min(6, b.level + 2)}` as "h3" | "h4" | "h5" | "h6";
        return <Tag key={key}>{inlines(b.c)}</Tag>;
      }
      case "code":
        return (
          <pre key={key}>
            <code>{b.v}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={key}>{blocks(b.c)}</blockquote>;
      case "hr":
        return <hr key={key} />;
      case "list": {
        const items = b.items.map((item, j) => (
          <li key={j} className={item.checked === null ? undefined : "rg-md__task"}>
            {item.checked !== null && (
              <input type="checkbox" checked={item.checked} disabled readOnly aria-label="Task" />
            )}
            {tight(item.c)}
          </li>
        ));
        return b.ordered ? (
          <ol key={key} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      default:
        return null;
    }
  });
}

export function Markdown({
  source,
  empty = "No description.",
}: {
  source: string;
  empty?: string;
}) {
  const tree = useMemo(() => parseMarkdown(source), [source]);
  if (tree.length === 0) return <p className="rg-md rg-md--empty">{empty}</p>;
  return <div className="rg-md">{blocks(tree)}</div>;
}
