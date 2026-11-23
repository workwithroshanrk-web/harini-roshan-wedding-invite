"use client";
import { useId, useRef, useState } from "react";
import {
  transferSchema,
  transferSections,
  sectionTables,
  type SectionId,
} from "@/lib/data-transfer";
export default function ExportAllData({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [scope, setScope] = useState("full"),
    [sections, setSections] = useState<SectionId[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div>
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={() => {
          setMessage("");
          dialog.current?.showModal();
        }}
      >
        Export data
      </button>
      <dialog ref={dialog} className="contact-import" aria-labelledby={titleId}>
        <h2 id={titleId}>Export wedding data</h2>
        <label>
          Export options
          <select
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="full">Full data — all sections</option>
            <option value="selective">Selective data — choose sections</option>
          </select>
        </label>
        {scope === "selective" && (
          <fieldset disabled={busy}>
            <legend>Data sections</legend>
            {transferSections.map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={sections.includes(s.id)}
                  onChange={(e) =>
                    setSections(
                      e.target.checked
                        ? [...sections, s.id]
                        : sections.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.label}
              </label>
            ))}
          </fieldset>
        )}
        <p>
          Includes all saved records in your chosen sections, including archived
          records. Supporting household, member or inventory records are
          included automatically when needed.
        </p>
        <p className="muted">
          The JSON file can be imported from Settings. Admin login information
          is excluded.
        </p>
        <div className="actions">
          <button
            type="button"
            disabled={busy || (scope === "selective" && !sections.length)}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                const response = await fetch(
                  scope === "full"
                    ? "/api/backup"
                    : `/api/backup?sections=${encodeURIComponent(sections.join(","))}`,
                );
                const data = await response.json();
                if (!response.ok)
                  throw Error(data.error || "Unable to export data.");
                const file = transferSchema.parse(data);
                const records = Object.values(file.tables).reduce(
                  (sum, rows) => sum + (rows?.length || 0),
                  0,
                );
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(file)], {
                    type: "application/json",
                  }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `wedding-${scope}-data-${file.createdAt.replace(/[:.]/g, "-")}.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                const sectionsCount =
                  file.version === 2
                    ? file.sections.length
                    : transferSections.length;
                const requested = new Set<string>(
                  file.version === 2
                    ? sectionTables(file.sections)
                    : Object.keys(file.tables),
                );
                const dependencies = Object.entries(file.tables)
                  .filter(([table]) => !requested.has(table))
                  .reduce((sum, [, rows]) => sum + (rows?.length || 0), 0);
                setMessage(
                  `Exported ${sectionsCount} sections with ${records} records${dependencies ? `, including ${dependencies} supporting records` : ""}.`,
                );
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Exporting..."
              : scope === "full"
                ? "Download full export"
                : "Download selected sections"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <p className="feedback" role="status">
          {message}
        </p>
      </dialog>
    </div>
  );
}
