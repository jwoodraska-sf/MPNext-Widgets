import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { VolunteerScheduleService, type ScheduleGroupMembership } from "@/services/volunteerScheduleService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["volunteer-schedule", "user-menu"] });
    const headers = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers }
      );
    }

    const svc = await VolunteerScheduleService.getInstance();

    const contactId = await svc.getContactIdFromUserGuid(claims.sub);
    if (!contactId) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404, headers });
    }

    const family = await svc.getHouseholdMembers(contactId);
    if (family.length === 0) {
      return NextResponse.json(
        { family: [], scheduledPositions: [], openSchedules: [], unavailableDates: [], familyMemberships: [], scheduleGroupMemberships: [] },
        { status: 200, headers }
      );
    }

    const contactIds = family.map((m) => m.Contact_ID);
    const participantIds = family
      .map((m) => m.Participant_ID)
      .filter((id): id is number => id !== null);

    const contactByParticipant = new Map<number, number>(
      family
        .filter((m) => m.Participant_ID !== null)
        .map((m) => [m.Participant_ID as number, m.Contact_ID])
    );

    // Fetch all data in parallel; scheduling tables may 404 if API client lacks that role
    const [scheduledPositions, openSchedulesRaw, unavailableDates, familyGroups] =
      await Promise.all([
        svc.getScheduledPositions(participantIds, contactByParticipant).catch((e) => {
          console.warn("[volunteer-schedule] getScheduledPositions failed (check API client role):", e instanceof Error ? e.message : e);
          return [];
        }),
        svc.getOpenSchedules().catch((e) => {
          console.warn("[volunteer-schedule] getOpenSchedules failed (check API client role):", e instanceof Error ? e.message : e);
          return [];
        }),
        svc.getUnavailableDates(contactIds).catch((e) => {
          console.warn("[volunteer-schedule] getUnavailableDates failed:", e instanceof Error ? e.message : e);
          return [];
        }),
        svc.getFamilyGroupMemberships(participantIds).catch((e) => {
          console.warn("[volunteer-schedule] getFamilyGroupMemberships failed:", e instanceof Error ? e.message : e);
          return [];
        }),
      ]);

    // Fetch all active group memberships for the family (with group/role names)
    const scheduleGroupMemberships = await svc.getScheduleGroupMemberships(participantIds).catch((e) => {
      console.warn("[volunteer-schedule] getScheduleGroupMemberships failed:", e instanceof Error ? e.message : e);
      return [] as ScheduleGroupMembership[];
    });

    // Build open schedules with roles + fill counts
    const openSchedules = await (async () => {
      if (openSchedulesRaw.length === 0) return [];
      try {
        const scheduleIds = openSchedulesRaw.map((s) => s.Schedule_ID);
        const roles = await svc.getScheduleRoles(scheduleIds);

        const roleIds = roles.map((r) => r.Schedule_Role_ID);
        const allAssignments = roleIds.length > 0 ? await svc.getRoleAssignments(roleIds) : [];

        const assignmentsByRole = new Map<number, typeof allAssignments[number][]>();
        for (const a of allAssignments) {
          const list = assignmentsByRole.get(a.Schedule_Role_ID) ?? [];
          list.push(a);
          assignmentsByRole.set(a.Schedule_Role_ID, list);
        }

        const rolesBySchedule = new Map<number, typeof roles[number][]>();
        for (const r of roles) {
          const list = rolesBySchedule.get(r.Schedule_ID) ?? [];
          list.push(r);
          rolesBySchedule.set(r.Schedule_ID, list);
        }

        const familyGroupIds = new Set(familyGroups.map((g) => g.Group_ID));

        return openSchedulesRaw.map((s) => {
          const scheduleRoles = (rolesBySchedule.get(s.Schedule_ID) ?? []).map((r) => {
            const roleAssignments = assignmentsByRole.get(r.Schedule_Role_ID) ?? [];
            const filledCount = roleAssignments.length;
            return {
              ...r,
              filledCount,
              unfilledCount: Math.max(0, r.Number_Of_Volunteers - filledCount),
              assignments: roleAssignments,
            };
          });

          return {
            ...s,
            familyInGroup: familyGroupIds.has(s.Group_ID),
            roles: scheduleRoles,
          };
        });
      } catch (e) {
        console.warn("[volunteer-schedule] getScheduleRoles/getRoleAssignments failed (check API client role):", e instanceof Error ? e.message : e);
        return [];
      }
    })();

    return NextResponse.json(
      {
        family,
        scheduledPositions,
        openSchedules,
        unavailableDates,
        familyMemberships: familyGroups.map((g) => ({
          Participant_ID: g.Participant_ID,
          Group_ID: g.Group_ID,
          Group_Role_ID: g.Group_Role_ID,
        })),
        scheduleGroupMemberships,
      },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("[volunteer-schedule] GET error:", error);
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
