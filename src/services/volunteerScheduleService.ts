import { MPHelper } from "@/lib/providers/ministry-platform";

export interface HouseholdMember {
  Contact_ID: number;
  First_Name: string;
  Nickname: string | null;
  Last_Name: string;
  Household_Position_ID: number;
  Household_Position: string;
  Participant_ID: number | null;
}

export interface ScheduledPosition {
  Schedule_Participant_ID: number;
  Participant_ID: number;
  Contact_ID: number;
  Schedule_Role_ID: number;
  Accepted: boolean | null;
  Notes: string | null;
  Role_Label: string | null;
  Volunteer_Role: string;
  Start_Time: string | null;
  End_Time: string | null;
  Schedule_ID: number;
  Schedule_Name: string;
  Event_Title: string;
  Event_Start_Date: string;
  Event_End_Date: string;
  Group_Name: string;
  Congregation_Name: string;
}

export interface ScheduleWithRoles {
  Schedule_ID: number;
  Schedule_Name: string;
  Group_ID: number;
  Group_Name: string;
  Congregation_Name: string;
  Allow_Volunteer_Signup: boolean;
  Accept_All_Assignments: boolean;
  Event_Title: string;
  Event_Start_Date: string;
  Event_End_Date: string;
  roles: ScheduleRole[];
}

export interface ScheduleRole {
  Schedule_Role_ID: number;
  Schedule_ID: number;
  Group_Role_ID: number;
  Role_Title: string;
  /** Display name: Role_Label if set, otherwise Role_Title */
  Volunteer_Role: string;
  Number_Of_Volunteers: number;
  Start_Time: string | null;
  End_Time: string | null;
  Notes: string | null;
  Sort_Order: number | null;
  /** Count of accepted + awaiting assignments (ISNULL(Accepted,1)=1) */
  filledCount: number;
  /** Unfilled = Number_Of_Volunteers - filledCount */
  unfilledCount: number;
  assignments: RoleAssignment[];
}

export interface RoleAssignment {
  Schedule_Participant_ID: number;
  Schedule_Role_ID: number;
  Participant_ID: number;
  Accepted: boolean | null;
}

export interface UnavailableDate {
  Volunteer_Unavailable_Date_ID: number;
  Contact_ID: number;
  Start_Date: string;
  End_Date: string;
}

export interface FamilyGroupMembership {
  Group_Participant_ID: number;
  Group_ID: number;
  Participant_ID: number;
  Group_Role_ID: number;
}

export interface ScheduleGroupMembership {
  Group_Participant_ID: number;
  Group_ID: number;
  Participant_ID: number;
  Group_Role_ID: number;
  Group_Name: string;
  Role_Title: string;
  Description: string | null;
}

export class VolunteerScheduleService {
  private static instance: VolunteerScheduleService;
  private mp: MPHelper | null = null;

  private constructor() {}

  public static async getInstance(): Promise<VolunteerScheduleService> {
    if (!VolunteerScheduleService.instance) {
      VolunteerScheduleService.instance = new VolunteerScheduleService();
      await VolunteerScheduleService.instance.initialize();
    }
    return VolunteerScheduleService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  public async getContactIdFromUserGuid(userGuid: string): Promise<number | null> {
    const users = await this.mp!.getTableRecords<{ User_ID: number; Contact_ID: number }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid}'`,
      select: "User_ID,Contact_ID",
      top: 1,
    });
    return users.length > 0 ? users[0].Contact_ID : null;
  }

  /**
   * Returns all active household members for a contact's primary household.
   * Participant_ID is read from Contact.Participant_Record (matching the SP pattern).
   */
  public async getHouseholdMembers(contactId: number): Promise<HouseholdMember[]> {
    const contactRows = await this.mp!.getTableRecords<{ Household_ID: number | null }>({
      table: "Contacts",
      filter: `Contact_ID = ${contactId}`,
      select: "Household_ID",
      top: 1,
    });
    if (contactRows.length === 0 || !contactRows[0].Household_ID) return [];

    const householdId = contactRows[0].Household_ID;
    const members = await this.mp!.getTableRecords<{
      Contact_ID: number;
      Household_Position_ID: number;
      Household_Position: string;
      First_Name: string;
      Nickname: string | null;
      Last_Name: string;
      Participant_Record: number | null;
    }>({
      table: "Contacts",
      filter: `Household_ID = ${householdId} AND Contact_Status_ID != 3`,
      select: [
        "Contacts.Contact_ID",
        "Contacts.Household_Position_ID",
        "Household_Position_ID_TABLE.Household_Position",
        "Contacts.First_Name",
        "Contacts.Nickname",
        "Contacts.Last_Name",
        "Contacts.Participant_Record",
      ].join(","),
      orderBy: "Contacts.Household_Position_ID ASC",
    });
    return members.map((m) => ({
      Contact_ID: m.Contact_ID,
      First_Name: m.First_Name,
      Nickname: m.Nickname,
      Last_Name: m.Last_Name,
      Household_Position_ID: m.Household_Position_ID,
      Household_Position: m.Household_Position,
      Participant_ID: m.Participant_Record ?? null,
    }));
  }

  /**
   * Returns upcoming scheduled positions for the given participants (all statuses).
   * Declined positions (Accepted=false) are included; the UI controls whether they are shown.
   */
  public async getScheduledPositions(
    participantIds: number[],
    contactByParticipant: Map<number, number>
  ): Promise<ScheduledPosition[]> {
    if (participantIds.length === 0) return [];

    const rows = await this.mp!.getTableRecords<{
      Schedule_Participant_ID: number;
      Participant_ID: number;
      Schedule_Role_ID: number;
      Accepted: boolean | null;
      Notes: string | null;
      Role_Label: string | null;
      Role_Title: string;
      Start_Time: string | null;
      End_Time: string | null;
      Schedule_Name: string;
      Schedule_ID: number;
      Event_Title: string;
      Event_Start_Date: string;
      Event_End_Date: string;
      Group_Name: string;
      Congregation_Name: string;
    }>({
      table: "Scheduled_Participants",
      // Include all statuses (null=Awaiting, true=Accepted, false=Declined); UI controls visibility of declined
      filter: [
        `Scheduled_Participants.Participant_ID IN (${participantIds.join(",")})`,
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE.Schedule_Status_ID = 2",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Event_ID_TABLE.Cancelled = 0",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Event_ID_TABLE.Event_Start_Date >= GETDATE()",
      ].join(" AND "),
      select: [
        "Scheduled_Participants.Schedule_Participant_ID",
        "Scheduled_Participants.Participant_ID",
        "Scheduled_Participants.Schedule_Role_ID",
        "Scheduled_Participants.Accepted",
        "Scheduled_Participants.Notes",
        "Schedule_Role_ID_TABLE.Role_Label",
        "Schedule_Role_ID_TABLE.Start_Time",
        "Schedule_Role_ID_TABLE.End_Time",
        "Schedule_Role_ID_TABLE_Group_Role_ID_TABLE.Role_Title",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE.Schedule_Name",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE.Schedule_ID",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Event_ID_TABLE.Event_Title",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Event_ID_TABLE.Event_Start_Date",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Event_ID_TABLE.Event_End_Date",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Group_ID_TABLE.Group_Name",
        "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Group_ID_TABLE_Congregation_ID_TABLE.Congregation_Name",
      ].join(","),
      orderBy: "Schedule_Role_ID_TABLE_Schedule_ID_TABLE_Event_ID_TABLE.Event_Start_Date ASC",
      top: 200,
    });

    return rows.map((r) => ({
      ...r,
      Volunteer_Role: r.Role_Label ?? r.Role_Title,
      Contact_ID: contactByParticipant.get(r.Participant_ID) ?? 0,
    }));
  }

  /**
   * Returns published schedules with Allow_Volunteer_Signup for future non-cancelled events.
   */
  public async getOpenSchedules(): Promise<Omit<ScheduleWithRoles, "roles">[]> {
    const rows = await this.mp!.getTableRecords<{
      Schedule_ID: number;
      Schedule_Name: string;
      Group_ID: number;
      Group_Name: string;
      Congregation_Name: string;
      Allow_Volunteer_Signup: boolean;
      Accept_All_Assignments: boolean;
      Event_Title: string;
      Event_Start_Date: string;
      Event_End_Date: string;
    }>({
      table: "Schedules",
      filter: [
        "Schedules.Schedule_Status_ID = 2",
        "Schedules.Allow_Volunteer_Signup = 1",
        "Event_ID_TABLE.Cancelled = 0",
        "Event_ID_TABLE.Event_Start_Date >= GETDATE()",
      ].join(" AND "),
      select: [
        "Schedules.Schedule_ID",
        "Schedules.Schedule_Name",
        "Schedules.Group_ID",
        "Schedules.Allow_Volunteer_Signup",
        "Schedules.Accept_All_Assignments",
        "Event_ID_TABLE.Event_Title",
        "Event_ID_TABLE.Event_Start_Date",
        "Event_ID_TABLE.Event_End_Date",
        "Group_ID_TABLE.Group_Name",
        "Group_ID_TABLE_Congregation_ID_TABLE.Congregation_Name",
      ].join(","),
      orderBy: "Event_ID_TABLE.Event_Start_Date ASC",
      top: 100,
    });
    return rows;
  }

  /**
   * Returns schedule roles for the given schedule IDs, sorted by Sort_Order (NULLs last).
   */
  public async getScheduleRoles(scheduleIds: number[]): Promise<Omit<ScheduleRole, "filledCount" | "unfilledCount" | "assignments">[]> {
    if (scheduleIds.length === 0) return [];
    const rows = await this.mp!.getTableRecords<{
      Schedule_Role_ID: number;
      Schedule_ID: number;
      Group_Role_ID: number;
      Number_Of_Volunteers: number;
      Start_Time: string | null;
      End_Time: string | null;
      Notes: string | null;
      Role_Label: string | null;
      Sort_Order: number | null;
      Role_Title: string;
    }>({
      table: "Schedule_Roles",
      filter: `Schedule_ID IN (${scheduleIds.join(",")})`,
      select: [
        "Schedule_Roles.Schedule_Role_ID",
        "Schedule_Roles.Schedule_ID",
        "Schedule_Roles.Group_Role_ID",
        "Schedule_Roles.Number_Of_Volunteers",
        "Schedule_Roles.Start_Time",
        "Schedule_Roles.End_Time",
        "Schedule_Roles.Notes",
        "Schedule_Roles.Role_Label",
        "Schedule_Roles.Sort_Order",
        "Group_Role_ID_TABLE.Role_Title",
      ].join(","),
      // Sort_Order NULLs last — done in code since MP can't easily sort NULLs last
    });

    return rows
      .map((r) => ({ ...r, Volunteer_Role: r.Role_Label ?? r.Role_Title }))
      .sort((a, b) => {
        const aSort = a.Sort_Order ?? 999999;
        const bSort = b.Sort_Order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return (a.Volunteer_Role ?? "").localeCompare(b.Volunteer_Role ?? "");
      });
  }

  /**
   * Returns assignments for the given role IDs.
   * Mirror SP: ISNULL(Accepted,1)=1 — counts awaiting + accepted, excludes declined.
   * Batches IDs to stay under IIS maxQueryStringLength (2048 bytes).
   */
  public async getRoleAssignments(scheduleRoleIds: number[]): Promise<RoleAssignment[]> {
    if (scheduleRoleIds.length === 0) return [];
    const BATCH_SIZE = 50;
    const batches: number[][] = [];
    for (let i = 0; i < scheduleRoleIds.length; i += BATCH_SIZE) {
      batches.push(scheduleRoleIds.slice(i, i + BATCH_SIZE));
    }
    const results = await Promise.all(
      batches.map((batch) =>
        this.mp!.getTableRecords<RoleAssignment>({
          table: "Scheduled_Participants",
          filter: `Schedule_Role_ID IN (${batch.join(",")}) AND (Accepted IS NULL OR Accepted = 1)`,
          select: "Schedule_Participant_ID, Schedule_Role_ID, Participant_ID, Accepted",
        })
      )
    );
    return results.flat();
  }

  public async getFamilyGroupMemberships(participantIds: number[]): Promise<FamilyGroupMembership[]> {
    if (participantIds.length === 0) return [];
    const rows = await this.mp!.getTableRecords<FamilyGroupMembership>({
      table: "Group_Participants",
      filter: `Participant_ID IN (${participantIds.join(",")}) AND (End_Date IS NULL OR End_Date > GETDATE())`,
      select: "Group_Participant_ID, Group_ID, Participant_ID, Group_Role_ID",
    });
    return rows;
  }

  /** Returns the Group_Role_ID and Group_ID for a given Schedule_Role. */
  public async getScheduleRoleGroupInfo(scheduleRoleId: number): Promise<{ Group_Role_ID: number; Group_ID: number } | null> {
    const rows = await this.mp!.getTableRecords<{ Group_Role_ID: number; Group_ID: number }>({
      table: "Schedule_Roles",
      filter: `Schedule_Role_ID = ${scheduleRoleId}`,
      select: "Schedule_Roles.Group_Role_ID, Schedule_ID_TABLE.Group_ID",
      top: 1,
    });
    return rows.length > 0 ? rows[0] : null;
  }

  /** Returns true if the participant is an active member of the group with the given role. */
  public async participantHasGroupRole(participantId: number, groupId: number, groupRoleId: number): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<{ Group_Participant_ID: number }>({
      table: "Group_Participants",
      filter: `Participant_ID = ${participantId} AND Group_ID = ${groupId} AND Group_Role_ID = ${groupRoleId} AND (End_Date IS NULL OR End_Date > GETDATE())`,
      select: "Group_Participant_ID",
      top: 1,
    });
    return rows.length > 0;
  }

  public async getUnavailableDates(contactIds: number[]): Promise<UnavailableDate[]> {
    if (contactIds.length === 0) return [];
    const rows = await this.mp!.getTableRecords<UnavailableDate>({
      table: "Volunteer_Unavailable_Dates",
      filter: `Contact_ID IN (${contactIds.join(",")}) AND End_Date >= GETDATE()`,
      select: "Volunteer_Unavailable_Date_ID, Contact_ID, Start_Date, End_Date",
      orderBy: "Start_Date ASC",
    });
    return rows;
  }

  public async acceptPosition(scheduleParticipantId: number): Promise<void> {
    await this.mp!.updateTableRecords("Scheduled_Participants", [
      { Schedule_Participant_ID: scheduleParticipantId, Accepted: true },
    ]);
  }

  public async declinePosition(scheduleParticipantId: number): Promise<void> {
    await this.mp!.updateTableRecords("Scheduled_Participants", [
      { Schedule_Participant_ID: scheduleParticipantId, Accepted: false },
    ]);
  }

  public async signupForRole(
    scheduleRoleId: number,
    participantId: number
  ): Promise<{ Schedule_Participant_ID: number }> {
    const results = await this.mp!.createTableRecords("Scheduled_Participants", [
      {
        Schedule_Role_ID: scheduleRoleId,
        Participant_ID: participantId,
        Accepted: true,
        Declined_and_Hidden: false,
      },
    ]);
    return results[0] as unknown as { Schedule_Participant_ID: number };
  }

  public async addUnavailableDate(
    contactId: number,
    startDate: string,
    endDate: string
  ): Promise<UnavailableDate> {
    const results = await this.mp!.createTableRecords("Volunteer_Unavailable_Dates", [
      { Contact_ID: contactId, Start_Date: startDate, End_Date: endDate },
    ]);
    return results[0] as UnavailableDate;
  }

  public async getScheduleGroupMemberships(participantIds: number[]): Promise<ScheduleGroupMembership[]> {
    if (participantIds.length === 0) return [];
    const rows = await this.mp!.getTableRecords<{
      Group_Participant_ID: number;
      Group_ID: number;
      Participant_ID: number;
      Group_Role_ID: number;
      Group_Name: string;
      Role_Title: string;
      Description: string | null;
    }>({
      table: "Group_Participants",
      filter: `Group_Participants.Participant_ID IN (${participantIds.join(",")}) AND (Group_Participants.End_Date IS NULL OR Group_Participants.End_Date > GETDATE()) AND Group_Role_ID_TABLE.Ministry_ID IN (5, 13)`,
      select: [
        "Group_Participants.Group_Participant_ID",
        "Group_Participants.Group_ID",
        "Group_Participants.Participant_ID",
        "Group_Participants.Group_Role_ID",
        "Group_ID_TABLE.Group_Name",
        "Group_Role_ID_TABLE.Role_Title",
        "Group_ID_TABLE.Description",
      ].join(","),
      orderBy: "Group_ID_TABLE.Group_Name ASC",
    });
    return rows.map((r) => ({
      Group_Participant_ID: r.Group_Participant_ID,
      Group_ID: r.Group_ID,
      Participant_ID: r.Participant_ID,
      Group_Role_ID: r.Group_Role_ID,
      Group_Name: r.Group_Name,
      Role_Title: r.Role_Title,
      Description: r.Description ?? null,
    }));
  }

  public async getGroupIdsWithSchedules(groupIds: number[]): Promise<Set<number>> {
    if (groupIds.length === 0) return new Set();
    const rows = await this.mp!.getTableRecords<{ Group_ID: number }>({
      table: "Schedules",
      filter: `Group_ID IN (${groupIds.join(",")})`,
      select: "Schedules.Group_ID",
      top: 1000,
    });
    return new Set(rows.map((r) => r.Group_ID));
  }

  public async removeUnavailableDate(id: number): Promise<void> {
    await this.mp!.deleteTableRecords("Volunteer_Unavailable_Dates", [id]);
  }
}
