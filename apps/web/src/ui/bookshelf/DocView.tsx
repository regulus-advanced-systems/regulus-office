/**
 * One document from the room's bookshelf, rendered (#264).
 *
 * A repo's Markdown is written by anyone who can push to it, so it is
 * untrusted. It goes through the office's one Markdown parser and renderer
 * (ui/boards/markdown.ts, Markdown.tsx): a tree of React elements, never
 * HTML. Raw HTML in the file is shown as the text it is; there is no way
 * for a document to produce a script, an event handler, a form, a frame or
 * a style.
 *
 * - Links to the web (`http`, `https`, `mailto` only) open in a new tab
 *   with `noopener noreferrer` and no referrer. Everything else with a
 *   scheme (`javascript:`, `data:`, `file:` ...) is its label, as text.
 * - Relative links are resolved inside the repo's tree
 *   (`resolveBookshelfLink`): one that names a document on the shelf opens
 *   it in the reader, `#heading` scrolls, anything else is text.
 * - Pictures: only a relative path to a raster image in the same repo is
 *   loaded, from the office's own gated route. A remote image is never
 *   loaded, so opening a document does not make the reader's browser call
 *   anyone; it is shown as a link the reader may choose to follow.
 */
import {
  bookshelfImageApiPath,
  isBookshelfImagePath,
  resolveBookshelfLink,
} from "@regulus/protocol";
import { type ReactNode, useMemo } from "react";
import { type MarkdownHooks, renderMarkdown } from "../boards/Markdown.tsx";
import { DOCUMENT_MARKDOWN, parseMarkdown } from "../boards/markdown.ts";
import { ANCHOR_ATTRIBUTE, createSlugger } from "./anchors.ts";

export interface DocViewProps {
  operationId: string;
  /** The document's path in the repo. */
  path: string;
  markdown: string;
  /** Paths of the documents on the shelf. */
  shelf: ReadonlySet<string>;
  onOpen(path: string, anchor: string): void;
}

export function DocView({ operationId, path, markdown, shelf, onOpen }: DocViewProps) {
  const tree = useMemo(() => parseMarkdown(markdown, DOCUMENT_MARKDOWN), [markdown]);
  // Rendering is cheap next to parsing; hooks close over the slugger, so both are made per render.
  const slug = createSlugger();
  const hooks: MarkdownHooks = {
    heading: (text) => ({ [ANCHOR_ATTRIBUTE]: slug(text) }),
    ref: (target, label, key): ReactNode => {
      const link = resolveBookshelfLink(path, target);
      if (!link || !shelf.has(link.path)) {
        return (
          <span key={key} className="rg-doc__offshelf" title="Not a document on this shelf">
            {label}
          </span>
        );
      }
      return (
        <a
          key={key}
          href="#"
          className="rg-doc__ref"
          data-doc-path={link.path}
          onClick={(event) => {
            event.preventDefault();
            onOpen(link.path, link.anchor);
          }}
        >
          {label}
        </a>
      );
    },
    image: (src, alt, key) => {
      const link = resolveBookshelfLink(path, src);
      if (!link || !isBookshelfImagePath(link.path)) return null;
      return (
        <img
          key={key}
          className="rg-doc__image"
          src={bookshelfImageApiPath(operationId, link.path)}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      );
    },
  };
  if (tree.length === 0) return <p className="rg-md rg-md--empty">This document is empty.</p>;
  return <div className="rg-md rg-doc">{renderMarkdown(tree, hooks)}</div>;
}
