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
    const { scheduleParticipantId, action } = body as {
      scheduleParticipantId: number;
      action: "accept" | "decline";
    };

    if (!scheduleParticipantId || !["accept", "decline"].includes(action)) {
      return NextResponse.json(
        { error: "scheduleParticipantId and action (accept|decline) are required" },
        { status: 400, headers }
      );
    }

    const svc = await VolunteerScheduleService.getInstance();

    // Verify the participant belongs to the logged-in user's household
    const contactId = await svc.getContactIdFromUserGuid(claims.sub);
    if (!contactId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404, headers });
    }

    if (action === "accept") {
      await svc.acceptPosition(scheduleParticipantId);
    } else {
      await svc.declinePosition(scheduleParticipantId);
    }

    return NextResponse.json({ success: true }, { status: 200, headers });
  } catch (error) {
    console.error("[volunteer-schedule/accept] POST error:", error);
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
