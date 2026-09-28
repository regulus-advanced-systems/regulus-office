/** A short, scrollable list of file paths (uncommitted changes). */
const SHOWN = 50;

export function FileList({ files, label }: { files: readonly string[]; label: string }) {
  const more = files.length - SHOWN;
  return (
    <ul className="rg-agent-files" aria-label={label}>
      {files.slice(0, SHOWN).map((f) => (
        <li key={f}>
          <code>{f}</code>
        </li>
      ))}
      {more > 0 && <li>… and {more} more</li>}
    </ul>
  );
}
