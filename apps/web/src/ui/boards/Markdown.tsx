/**
 * Renders a markdown body or comment (#36) from the tree in markdown.ts as
 * React elements: text is always escaped by React, no HTML is injected,
 * links open in a new tab without a referrer or opener, and images are
 * links, never loaded.
 *
 * `renderMarkdown` is the one renderer; the room's bookshelf (#264) uses it
 * too, with hooks that say what a relative link and a relative image in a
 * repo's document become. Without hooks they are their label, as text.
 */
import { type ReactNode, useMemo } from "react";
import { type Block, type Inline, parseMarkdown } from "./markdown.ts";

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
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

export interface MarkdownHooks {
  /** Added to every heading's level (a card's title is the panel's h2, so its body starts at h3). */
  headingShift?: number;
  /** Props for a heading element, from its plain text (an anchor to scroll to). */
  heading?: (text: string) => Record<string, string> | undefined;
  /** A relative link (`ref` node). */
  ref?: (target: string, label: ReactNode[], key: number) => ReactNode;
  /** A relative image (`src`); null falls back to the label. */
  image?: (src: string, alt: string, key: number) => ReactNode | null;
}

/** The text of inline nodes, without formatting. */
export function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      if (n.t === "text" || n.t === "code") return n.v;
      if (n.t === "image") return n.alt;
      return n.t === "br" ? " " : plainText(n.c);
    })
    .join("");
}

export function renderMarkdown(tree: readonly Block[], hooks: MarkdownHooks = {}): ReactNode[] {
  const shift = hooks.headingShift ?? 0;

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
            <ExternalLink key={key} href={n.href}>
              {inlines(n.c)}
            </ExternalLink>
          );
        case "ref":
          return hooks.ref ? (
            hooks.ref(n.target, inlines(n.c), key)
          ) : (
            <span key={key}>{inlines(n.c)}</span>
          );
        case "image": {
          const shown = n.src && hooks.image ? hooks.image(n.src, n.alt, key) : null;
          if (shown) return shown;
          const label = `Image: ${n.alt || "untitled"}`;
          return n.href ? (
            <ExternalLink key={key} href={n.href}>
              <span className="rg-md__image">{label}</span>
            </ExternalLink>
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
          const Tag = `h${Math.min(6, b.level + shift)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          return (
            <Tag key={key} {...hooks.heading?.(plainText(b.c))}>
              {inlines(b.c)}
            </Tag>
          );
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
        case "table":
          return (
            <div key={key} className="rg-md__table">
              <table>
                <thead>
                  <tr>
                    {b.head.map((cell, j) => (
                      <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                        {inlines(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, j) => (
                        <td key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                          {inlines(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
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

  return blocks(tree);
}

/** Card titles are the panel's h2; body headings sit below them. */
const CARD_HOOKS: MarkdownHooks = { headingShift: 2 };

export function Markdown({
  source,
  empty = "No description.",
}: {
  source: string;
  empty?: string;
}) {
  const tree = useMemo(() => parseMarkdown(source), [source]);
  if (tree.length === 0) return <p className="rg-md rg-md--empty">{empty}</p>;
  return <div className="rg-md">{renderMarkdown(tree, CARD_HOOKS)}</div>;
}
