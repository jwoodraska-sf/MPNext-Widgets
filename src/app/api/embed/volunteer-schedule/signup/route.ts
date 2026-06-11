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
    const { scheduleRoleId, participantId } = body as {
      scheduleRoleId: number;
      participantId: number;
    };

    if (!scheduleRoleId || !participantId) {
      return NextResponse.json(
        { error: "scheduleRoleId and participantId are required" },
        { status: 400, headers }
      );
    }

    const svc = await VolunteerScheduleService.getInstance();

    // Resolve the logged-in contact and their household
    const contactId = await svc.getContactIdFromUserGuid(claims.sub);
    if (!contactId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404, headers });
    }

    const family = await svc.getHouseholdMembers(contactId);

    // Verify the target participant belongs to the logged-in user's household
    const target = family.find((m) => m.Participant_ID === participantId);
    if (!target) {
      return NextResponse.json(
        { error: "Participant does not belong to your household" },
        { status: 403, headers }
      );
    }

    // Verify the participant holds the matching group role for this schedule role
    const roleInfo = await svc.getScheduleRoleGroupInfo(scheduleRoleId);
    if (!roleInfo) {
      return NextResponse.json({ error: "Schedule role not found" }, { status: 404, headers });
    }
    const eligible = await svc.participantHasGroupRole(participantId, roleInfo.Group_ID, roleInfo.Group_Role_ID);
    if (!eligible) {
      return NextResponse.json(
        { error: "You are not assigned to this volunteer role in this group" },
        { status: 403, headers }
      );
    }

    const result = await svc.signupForRole(scheduleRoleId, participantId);

    return NextResponse.json({ success: true, scheduleParticipantId: result.Schedule_Participant_ID }, { status: 201, headers });
  } catch (error) {
    console.error("[volunteer-schedule/signup] POST error:", error);
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
