import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { VolunteerScheduleService } from "@/services/volunteerScheduleService";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["volunteer-schedule", "user-menu"] });
    const headers = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
    }

    const { id } = await params;
    const unavailableId = parseInt(id, 10);
    if (isNaN(unavailableId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400, headers });
    }

    const svc = await VolunteerScheduleService.getInstance();

    // Verify the record belongs to the logged-in user's household before deleting
    const loggedInContactId = await svc.getContactIdFromUserGuid(claims.sub);
    if (!loggedInContactId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404, headers });
    }

    const family = await svc.getHouseholdMembers(loggedInContactId);
    const familyContactIds = family.map((m) => m.Contact_ID);
    const existing = await svc.getUnavailableDates(familyContactIds);
    const record = existing.find((d) => d.Volunteer_Unavailable_Date_ID === unavailableId);

    if (!record) {
      return NextResponse.json(
        { error: "Record not found or does not belong to your household" },
        { status: 404, headers }
      );
    }

    await svc.removeUnavailableDate(unavailableId);

    return NextResponse.json({ success: true }, { status: 200, headers });
  } catch (error) {
    console.error("[volunteer-schedule/unavailable/[id]] DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Missing") ? 401 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
