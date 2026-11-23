"use client";
import { useState } from "react";
export async function api(action: string, data: Record<string, unknown> = {}) {
  const r = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || "Unable to save.");
  return body;
}
export function Form({
  action,
  extra = {},
  children,
  onDone,
}: {
  action: string;
  extra?: Record<string, unknown>;
  children?: React.ReactNode;
  onDone?: (r: any) => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const data = Object.fromEntries(new FormData(e.currentTarget));
          const r = await api(action, { ...data, ...extra });
          setMessage(
            r.link ? `${location.origin}${r.link}` : "Saved successfully.",
          );
          if (onDone) onDone(r);
          else if (!r.link) location.reload();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <p role="status" className="feedback">
        {message}
      </p>
      <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      {message.startsWith("http") && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(message)}
        >
          Copy invitation link
        </button>
      )}
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  value = "",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  value?: any;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        required={required}
      />
    </label>
  );
}
export function Select({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
export function Action({
  action,
  data,
  children,
  confirm = false,
}: {
  action: string;
  data?: Record<string, unknown>;
  children: React.ReactNode;
  confirm?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        disabled={busy}
        type="button"
        className="secondary"
        onClick={async () => {
          if (confirm && !window.confirm("Continue with this change?")) return;
          setBusy(true);
          try {
            await api(action, data);
            location.reload();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
