"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { maxBackupBytes } from "@/lib/backup-format";
import {
  transferSchema,
  transferSections,
  type TransferFile,
  type ImportMode,
  type ImportPreview,
} from "@/lib/data-transfer";
import ExportAllData from "./export-all-data";
export default function DatabaseTransfer() {
  const router = useRouter();
  const [file, setFile] = useState<TransferFile | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [mode, setMode] = useState<ImportMode>("keep"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function request(action: "preview" | "import") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/backup?action=${action}&mode=${mode}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(action === "import"
              ? { "X-Import-Preview": preview?.token || "" }
              : {}),
          },
          body: JSON.stringify(file),
        },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (action === "preview") setPreview(result.preview);
      else {
        setMessage(
          `Import complete: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`,
        );
        setPreview(null);
        setFile(null);
        router.refresh();
      }
    } catch (e) {
      setPreview(null);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="paper">
      <h2>Import & export wedding data</h2>
      <p>
        Export everything or choose sections such as Households, Dress and
        Accommodation. Import recognizes full and selective files and previews
        the records before saving.
      </p>
      <p className="muted">
        Admin accounts, sessions and rate-limit counters are excluded. Keep
        export files private.
      </p>
      <ExportAllData disabled={busy} />
      <h3>Import data</h3>
      <label>
        Full or selective export (.json, up to 4 MB)
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            setFile(null);
            setPreview(null);
            setMessage("");
            if (!chosen) return;
            setBusy(true);
            try {
              if (chosen.size > maxBackupBytes)
                throw Error(
                  "File exceeds 4 MB. Use PostgreSQL tools for larger databases.",
                );
              const parsed = transferSchema.safeParse(
                JSON.parse(await chosen.text()),
              );
              if (!parsed.success)
                throw Error("Choose a valid full or selective wedding export.");
              setFile(parsed.data);
              setMode(parsed.data.version === 1 ? "restore" : "keep");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {file && (
        <>
          <p>
            <strong>
              {file.version === 1
                ? "Full data export"
                : "Selective data export"}
            </strong>{" "}
            ·{" "}
            {Object.values(file.tables).reduce(
              (sum, rows) => sum + (rows?.length || 0),
              0,
            )}{" "}
            records
          </p>
          {file.version === 2 && (
            <p>
              Selected sections:{" "}
              {transferSections
                .filter((s) => file.sections.includes(s.id))
                .map((s) => s.label)
                .join(", ")}
              . Required supporting records are also included.
            </p>
          )}
          <label>
            How should existing data be handled?
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => {
                setMode(e.target.value as ImportMode);
                setPreview(null);
                setMessage("");
              }}
            >
              {file.version === 1 && (
                <option value="restore">
                  Restore full data into an empty workspace
                </option>
              )}
              <option value="keep">Merge — keep existing records</option>
              <option value="update">
                Merge — update matching records from this file
              </option>
            </select>
          </label>
          <p className="muted">
            {mode === "restore"
              ? "Requires an empty wedding workspace. Your destination admin login stays the same."
              : mode === "keep"
                ? "Adds missing records and skips saved records with the same ID. Other data stays in place."
                : "Adds missing records and updates matching IDs only in the selected sections. Existing supporting records and records outside the file stay in place."}{" "}
            Mobile numbers and other unique values remain unique; conflicting
            records with different IDs must be resolved before import.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => request("preview")}
          >
            {busy ? "Working..." : "Review import"}
          </button>
        </>
      )}
      {preview && (
        <>
          <p>
            Ready: <strong>{preview.added} added</strong>,{" "}
            <strong>{preview.updated} updated</strong>,{" "}
            <strong>{preview.skipped} skipped</strong>. {preview.conflicts}{" "}
            existing records differ from the file and follow the selected import
            option.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Add</th>
                  <th>Update</th>
                  <th>Skip</th>
                </tr>
              </thead>
              <tbody>
                {preview.tables.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name.replaceAll("_", " ")}</td>
                    <td>{t.added}</td>
                    <td>{t.updated}</td>
                    <td>{t.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => request("import")}
          >
            {busy
              ? "Importing..."
              : mode === "update"
                ? "Import and update matching records"
                : "Import reviewed data"}
          </button>
        </>
      )}
      <p className="feedback" role="status">
        {message}
      </p>
    </section>
  );
}
