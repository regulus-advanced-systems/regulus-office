/**
 * The changed files as a tree (#38). Each file shows its kind, line counts
 * and whether it is committed yet. The robot's owner also gets a checkbox
 * (include in the commit) and Discard on uncommitted files; everyone else
 * sees the same tree read-only.
 */
import type { ChangedFile } from "@regulus/protocol";
import { buildTree, KIND_BADGE, KIND_LABEL, type TreeNode } from "./tree.ts";

export interface FileTreeProps {
  files: readonly ChangedFile[];
  selected: string | null;
  onSelect: (path: string) => void;
  /** Owner only: which uncommitted files go into the commit. */
  included?: ReadonlySet<string>;
  onToggleInclude?: (path: string) => void;
  onDiscard?: (file: ChangedFile) => void;
}

function Counts({ file }: { file: ChangedFile }) {
  if (file.binary) return <span className="rg-changes-file__counts">bin</span>;
  if (file.additions === null) return null;
  return (
    <span className="rg-changes-file__counts">
      <span className="rg-changes-add">+{file.additions}</span>{" "}
      <span className="rg-changes-del">-{file.deletions}</span>
    </span>
  );
}

function Node({ node, depth, props }: { node: TreeNode; depth: number; props: FileTreeProps }) {
  if (node.type === "dir") {
    return (
      <li className="rg-changes-dir">
        <div className="rg-changes-dir__name" style={{ paddingLeft: depth * 12 }}>
          {node.name}/
        </div>
        <ul className="rg-changes-tree__list">
          {node.children.map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} props={props} />
          ))}
        </ul>
      </li>
    );
  }
  const { file } = node;
  const active = props.selected === file.path;
  const writable = file.uncommitted && props.onToggleInclude;
  return (
    <li
      className="rg-changes-file"
      data-path={file.path}
      data-active={active || undefined}
      style={{ paddingLeft: depth * 12 }}
    >
      {writable && (
        <input
          type="checkbox"
          className="rg-changes-file__check"
          aria-label={`Include ${file.path} in the commit`}
          checked={props.included?.has(file.path) ?? false}
          onChange={() => props.onToggleInclude?.(file.path)}
        />
      )}
      <button
        type="button"
        className="rg-changes-file__name"
        aria-current={active ? "true" : undefined}
        title={`${file.path} (${KIND_LABEL[file.kind]}${file.uncommitted ? ", uncommitted" : ""})`}
        onClick={() => props.onSelect(file.path)}
      >
        <span
          className={`rg-changes-badge rg-changes-badge--${file.kind}`}
          aria-label={KIND_LABEL[file.kind]}
        >
          {KIND_BADGE[file.kind]}
        </span>
        <span className="rg-changes-file__label">{node.name}</span>
        {file.uncommitted && (
          <span className="rg-changes-dot" title="uncommitted" aria-label="uncommitted" />
        )}
        <Counts file={file} />
      </button>
      {writable && props.onDiscard && (
        <button
          type="button"
          className="rg-changes-file__discard"
          aria-label={`Discard changes to ${file.path}`}
          title="Discard uncommitted changes"
          onClick={() => props.onDiscard?.(file)}
        >
          ↺
        </button>
      )}
    </li>
  );
}

export function FileTree(props: FileTreeProps) {
  const root = buildTree(props.files);
  return (
    <ul className="rg-changes-tree rg-changes-tree__list" aria-label="Changed files">
      {root.children.map((c) => (
        <Node key={c.path} node={c} depth={0} props={props} />
      ))}
    </ul>
  );
}
