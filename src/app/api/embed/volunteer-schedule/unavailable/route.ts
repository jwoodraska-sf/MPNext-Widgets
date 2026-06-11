import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { VolunteerScheduleService } from "@/services/volunteerScheduleService";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["volunteer-schedule", "user-menu"] });
    const headers = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
    }

    const body = await req.json();
    const { contactId, startDate, endDate } = body as {
      contactId: number;
      startDate: string;
      endDate: string;
    };

    if (!contactId || !startDate || !endDate) {
      return NextResponse.json(
        { error: "contactId, startDate, and endDate are required" },
        { status: 400, headers }
      );
    }

    if (new Date(startDate) > new Date(endDate)) {
      return NextResponse.json(
        { error: "startDate must be on or before endDate" },
        { status: 400, headers }
      );
    }

    const svc = await VolunteerScheduleService.getInstance();

    // Verify contactId belongs to the logged-in user's household
    const loggedInContactId = await svc.getContactIdFromUserGuid(claims.sub);
    if (!loggedInContactId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404, headers });
    }

    const family = await svc.getHouseholdMembers(loggedInContactId);
    const familyContactIds = new Set(family.map((m) => m.Contact_ID));

    if (!familyContactIds.has(contactId)) {
      return NextResponse.json(
        { error: "Contact does not belong to your household" },
        { status: 403, headers }
      );
    }

    const record = await svc.addUnavailableDate(contactId, startDate, endDate);

    return NextResponse.json({ success: true, record }, { status: 201, headers });
  } catch (error) {
    console.error("[volunteer-schedule/unavailable] POST error:", error);
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
