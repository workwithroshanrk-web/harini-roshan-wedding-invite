import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { exportBackup, restoreBackup } from "@/lib/database-backup";
import { maxBackupBytes } from "@/lib/backup-format";
import {
  selectExport,
  selectedSectionsSchema,
  importModeSchema,
} from "@/lib/data-transfer";
import { previewImport, importBackup } from "@/lib/import-backup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  try {
    const selected = req.nextUrl.searchParams.get("sections");
    const sections =
      selected === null
        ? null
        : selectedSectionsSchema.safeParse(selected.split(","));
    if (sections && !sections.success)
      return NextResponse.json(
        { error: "Choose one or more valid data sections." },
        { status: 400 },
      );
    const full = await exportBackup();
    const backup = sections?.success ? selectExport(full, sections.data) : full;
    const body = JSON.stringify(backup);
    if (Buffer.byteLength(body) > maxBackupBytes)
      return NextResponse.json(
        {
          error:
            "This backup exceeds 4 MB. Use PostgreSQL pg_dump/pg_restore for a larger database.",
        },
        { status: 413 },
      );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="wedding-backup-${backup.createdAt.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to export the database backup." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (
    req.headers.get("origin") !== new URL(process.env.APP_URL || req.url).origin
  )
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  try {
    const reader = req.body?.getReader();
    if (!reader) throw Error("Choose a backup file.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBackupBytes) {
        await reader.cancel();
        return NextResponse.json(
          {
            error:
              "Backup must be smaller than 4 MB. Use pg_dump/pg_restore for larger databases.",
          },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const action = req.nextUrl.searchParams.get("action");
    const mode = importModeSchema.safeParse(
      req.nextUrl.searchParams.get("mode") || "keep",
    );
    if (!mode.success) throw Error("Choose a valid import option.");
    if (action === "preview")
      return NextResponse.json({
        ok: true,
        preview: await previewImport(input, mode.data),
      });
    const result =
      action === "import"
        ? await importBackup(
            input,
            mode.data,
            req.headers.get("x-import-preview") || "",
          )
        : action === null
          ? await restoreBackup(input)
          : (() => {
              throw Error("Unknown import action.");
            })();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const err = e as Error & { code?: string };
    const error = err.code
      ? "Backup could not be restored: check mobile uniqueness and related records. No records were changed."
      : e instanceof SyntaxError
        ? "Choose a valid JSON backup file."
        : err.message;
    return NextResponse.json({ error }, { status: 400 });
  }
}
