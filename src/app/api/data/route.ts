import { NextResponse } from "next/server";
import { loadDashboardData } from "@/lib/sheets";

// No caching: every request re-reads the Google Sheet so edits show immediately

export async function GET() {
  try {
    const data = await loadDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
