import { MPNextWidget } from "../shared/base-widget";

// ── Types ────────────────────────────────────────────────────────────────────

interface HouseholdMember {
  Contact_ID: number;
  First_Name: string;
  Nickname: string | null;
  Last_Name: string;
  Household_Position_ID: number;
  Household_Position: string;
  Participant_ID: number | null;
}

interface ScheduledPosition {
  Schedule_Participant_ID: number;
  Participant_ID: number;
  Contact_ID: number;
  Accepted: boolean | null;
  Volunteer_Role: string;
  Start_Time: string | null;
  End_Time: string | null;
  Schedule_Name: string;
  Event_Title: string;
  Event_Start_Date: string;
  Group_Name: string;
  Congregation_Name: string;
}

interface RoleAssignment {
  Schedule_Participant_ID: number;
  Schedule_Role_ID: number;
  Participant_ID: number;
  Accepted: boolean | null;
}

interface ScheduleRole {
  Schedule_Role_ID: number;
  Schedule_ID: number;
  Group_Role_ID: number;
  Volunteer_Role: string;
  Number_Of_Volunteers: number;
  Start_Time: string | null;
  End_Time: string | null;
  Notes: string | null;
  Sort_Order: number | null;
  filledCount: number;
  unfilledCount: number;
  assignments: RoleAssignment[];
}

interface OpenSchedule {
  Schedule_ID: number;
  Schedule_Name: string;
  Group_ID: number;
  Group_Name: string;
  Congregation_ID: number | null;
  Congregation_Name: string;
  Accept_All_Assignments: boolean;
  Event_Title: string;
  Event_Start_Date: string;
  Event_End_Date: string;
  familyInGroup: boolean;
  roles: ScheduleRole[];
}

interface UnavailableDate {
  Volunteer_Unavailable_Date_ID: number;
  Contact_ID: number;
  Start_Date: string;
  End_Date: string;
}

interface FamilyGroupMembership {
  Participant_ID: number;
  Group_ID: number;
  Group_Role_ID: number;
}

interface ScheduleGroupMembership {
  Group_Participant_ID: number;
  Group_ID: number;
  Participant_ID: number;
  Group_Role_ID: number;
  Group_Name: string;
  Role_Title: string;
  Description: string | null;
}

interface WidgetData {
  family: HouseholdMember[];
  householdCongregationId: number | null;
  scheduledPositions: ScheduledPosition[];
  openSchedules: OpenSchedule[];
  unavailableDates: UnavailableDate[];
  familyMemberships: FamilyGroupMembership[];
  scheduleGroupMemberships: ScheduleGroupMembership[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────


function displayName(m: HouseholdMember): string {
  return `${m.Nickname ?? m.First_Name} ${m.Last_Name}`;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  // MP returns time as HH:MM:SS or "HH:MM AM/PM"
  try {
    const [h, m] = t.split(":");
    const hour = parseInt(h, 10);
    const min = m?.padStart(2, "0") ?? "00";
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${h12}:${min} ${ampm}`;
  } catch {
    return t;
  }
}

function weekendGroup(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0=Sun,6=Sat
  if (day === 6) return iso.slice(0, 10);
  if (day === 0) {
    const sat = new Date(d);
    sat.setDate(sat.getDate() - 1);
    return sat.toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}

// ── Widget ───────────────────────────────────────────────────────────────────

export class VolunteerScheduleWidget extends MPNextWidget {
  private data: WidgetData | null = null;
  private activeTab: "schedule" | "open" | "unavailable" | "groups" = "schedule";
  private loading = true;
  private error: string | null = null;
  private toast: string | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private showOnlyFamilyGroups = true;
  private showDeclined = false;

  connectedCallback() {
    this.render();
    this.loadData();
  }

  // ── Data loading ────────────────────────────────────────────────────────

  private async loadData() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      const res = await this.fetch("/api/embed/volunteer-schedule");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      this.data = await res.json();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load data";
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async acceptPosition(scheduleParticipantId: number, action: "accept" | "decline") {
    try {
      const res = await this.fetch("/api/embed/volunteer-schedule/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleParticipantId, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.showToast(action === "accept" ? "Position accepted!" : "Position declined.");
      await this.loadData();
    } catch {
      this.showToast("Failed to update position. Please try again.", true);
    }
  }

  private async signupForRole(scheduleRoleId: number, participantId: number) {
    try {
      const res = await this.fetch("/api/embed/volunteer-schedule/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleRoleId, participantId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      this.showToast("Signed up successfully!");
      await this.loadData();
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : "Sign-up failed.", true);
    }
  }

  private async addUnavailable(contactIds: number[], startDate: string, endDate: string) {
    try {
      await Promise.all(
        contactIds.map((contactId) =>
          this.fetch("/api/embed/volunteer-schedule/unavailable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactId, startDate, endDate }),
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error ?? `HTTP ${res.status}`);
            }
          })
        )
      );
      this.showToast(contactIds.length > 1 ? "Unavailable dates added for all selected members." : "Unavailable date added.");
      await this.loadData();
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : "Failed to add dates.", true);
    }
  }

  private async removeUnavailable(id: number) {
    try {
      const res = await this.fetch(`/api/embed/volunteer-schedule/unavailable/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.showToast("Unavailable date removed.");
      await this.loadData();
    } catch {
      this.showToast("Failed to remove date.", true);
    }
  }

  private showToast(msg: string, isError = false) {
    this.toast = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.render();
    }, 3500);
    // Re-render with toast (pass isError via data attribute workaround)
    const toastEl = this.root.querySelector<HTMLElement>(".vs-toast");
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.className = `vs-toast ${isError ? "vs-toast--error" : "vs-toast--ok"} vs-toast--visible`;
    } else {
      this.render();
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  render() {
    this.root.innerHTML = `<style>${this.styles()}</style>${this.template()}`;
    this.bindEvents();
  }

  private template(): string {
    if (this.loading) return this.loadingTpl();
    if (this.error) return this.errorTpl();

    const d = this.data!;

    return `
      <div class="vs-widget">
        <div class="vs-header">
          <h2 class="vs-title">Volunteer Schedule</h2>
          ${this.familyBadgesTpl(d.family)}
        </div>

        <div class="vs-tabs" role="tablist">
          <button role="tab" class="vs-tab ${this.activeTab === "schedule" ? "vs-tab--active" : ""}" data-tab="schedule">
            My Schedule
            ${this.pendingBadge(d)}
          </button>
          <button role="tab" class="vs-tab ${this.activeTab === "open" ? "vs-tab--active" : ""}" data-tab="open">
            Available Opportunities
          </button>
          <button role="tab" class="vs-tab ${this.activeTab === "unavailable" ? "vs-tab--active" : ""}" data-tab="unavailable">
            Unavailability
          </button>
          <button role="tab" class="vs-tab ${this.activeTab === "groups" ? "vs-tab--active" : ""}" data-tab="groups">
            My Groups
          </button>
        </div>

        <div class="vs-panel">
          ${this.activeTab === "schedule" ? this.scheduleTpl(d) : ""}
          ${this.activeTab === "open" ? this.openPositionsTpl(d) : ""}
          ${this.activeTab === "unavailable" ? this.unavailableTpl(d) : ""}
          ${this.activeTab === "groups" ? this.myGroupsTpl(d) : ""}
        </div>

        ${this.toast ? `<div class="vs-toast vs-toast--ok vs-toast--visible">${this.escHtml(this.toast)}</div>` : ""}
      </div>
    `;
  }

  private loadingTpl(): string {
    return `
      <div class="vs-widget vs-loading">
        <div class="vs-spinner"></div>
        <p>Loading volunteer schedule…</p>
      </div>`;
  }

  private errorTpl(): string {
    return `
      <div class="vs-widget vs-error">
        <p class="vs-error-msg">${this.escHtml(this.error!)}</p>
        <button class="vs-btn vs-btn--primary" data-action="retry">Retry</button>
      </div>`;
  }

  private familyBadgesTpl(family: HouseholdMember[]): string {
    return `
      <div class="vs-family-badges">
        ${family.map((m) => `
          <span class="vs-badge vs-badge--pos-${m.Household_Position_ID}" title="${this.escHtml(m.Household_Position)}">
            ${this.escHtml(m.Nickname ?? m.First_Name)}
          </span>`).join("")}
      </div>`;
  }

  private pendingBadge(d: WidgetData): string {
    const pendingCount = d.scheduledPositions.filter((p) => p.Accepted === null).length;
    return pendingCount > 0
      ? `<span class="vs-count-badge">${pendingCount}</span>`
      : "";
  }

  // ── Schedule tab ──────────────────────────────────────────────────────────

  private scheduleTpl(d: WidgetData): string {
    const positions = this.showDeclined
      ? d.scheduledPositions
      : d.scheduledPositions.filter((p) => p.Accepted !== false);

    const hasDeclined = d.scheduledPositions.some((p) => p.Accepted === false);

    const emptyMsg = d.scheduledPositions.length === 0
      ? "No upcoming scheduled positions for your family."
      : "No upcoming scheduled positions to show.";

    // Group by family member
    const byContact = new Map<number, ScheduledPosition[]>();
    for (const pos of positions) {
      const list = byContact.get(pos.Contact_ID) ?? [];
      list.push(pos);
      byContact.set(pos.Contact_ID, list);
    }

    return `
      <div class="vs-schedule-list">
        ${hasDeclined ? `
          <div class="vs-filter-bar">
            <label class="vs-toggle-label">
              <input type="checkbox" class="vs-toggle" data-action="toggle-show-declined"
                ${this.showDeclined ? "checked" : ""}>
              Show declined assignments
            </label>
          </div>` : ""}
        ${positions.length === 0
          ? `<div class="vs-empty"><p>${emptyMsg}</p></div>`
          : d.family
              .filter((m) => byContact.has(m.Contact_ID))
              .map((m) => this.memberScheduleTpl(m, byContact.get(m.Contact_ID)!))
              .join("")}
      </div>`;
  }

  private memberScheduleTpl(member: HouseholdMember, positions: ScheduledPosition[]): string {
    // Group by weekend
    const grouped = new Map<string, ScheduledPosition[]>();
    for (const p of positions) {
      const wg = weekendGroup(p.Event_Start_Date);
      const list = grouped.get(wg) ?? [];
      list.push(p);
      grouped.set(wg, list);
    }

    return `
      <div class="vs-member-section">
        <div class="vs-member-header">
          <span class="vs-member-name">${this.escHtml(displayName(member))}</span>
          <span class="vs-member-role">${this.escHtml(member.Household_Position)}</span>
        </div>
        ${Array.from(grouped.entries()).map(([wg, wPositions]) => `
          <div class="vs-weekend-group">
            <div class="vs-weekend-label">${this.escHtml(this.fmtWeekend(wg))}</div>
            ${wPositions.map((p) => this.positionCardTpl(p)).join("")}
          </div>`).join("")}
      </div>`;
  }

  private positionCardTpl(pos: ScheduledPosition): string {
    const statusClass =
      pos.Accepted === null ? "vs-status--awaiting" :
      pos.Accepted === true ? "vs-status--accepted" :
      "vs-status--declined";
    const statusLabel =
      pos.Accepted === null ? "Awaiting" :
      pos.Accepted === true ? "Accepted" :
      "Declined";
    const timeStr = pos.Start_Time ? fmtTime(pos.Start_Time) + (pos.End_Time ? ` – ${fmtTime(pos.End_Time)}` : "") : "";

    return `
      <div class="vs-position-card ${pos.Accepted === null ? "vs-position-card--pending" : ""}">
        <div class="vs-position-main">
          <div class="vs-position-title">${this.escHtml(pos.Event_Title)}</div>
          <div class="vs-position-meta">
            <span class="vs-position-role">${this.escHtml(pos.Volunteer_Role)}</span>
            ${timeStr ? `<span class="vs-position-time">${this.escHtml(timeStr)}</span>` : ""}
          </div>
          <div class="vs-position-detail">
            ${this.escHtml(pos.Group_Name)}${pos.Congregation_Name ? ` · ${this.escHtml(pos.Congregation_Name)}` : ""}
          </div>
        </div>
        <div class="vs-position-actions">
          <span class="vs-status ${statusClass}">${statusLabel}</span>
          ${pos.Accepted === null ? `
            <button class="vs-btn vs-btn--accept" data-action="accept-pos" data-id="${pos.Schedule_Participant_ID}">Accept</button>
            <button class="vs-btn vs-btn--decline" data-action="decline-pos" data-id="${pos.Schedule_Participant_ID}">Decline</button>
          ` : ""}
        </div>
      </div>`;
  }

  private fmtWeekend(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00");
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(d) + " Weekend";
  }

  // ── Open Positions tab ────────────────────────────────────────────────────

  private openPositionsTpl(d: WidgetData): string {
    const members = d.family.filter((m) => m.Participant_ID !== null);

    let schedules = d.openSchedules;
    if (this.showOnlyFamilyGroups) {
      schedules = schedules.filter((s) => s.familyInGroup);
    } else if (d.householdCongregationId) {
      schedules = schedules.filter((s) => s.Congregation_ID === d.householdCongregationId);
    }

    const hasOpenSlots = schedules.some((s) => s.roles.some((r) => r.unfilledCount > 0));

    return `
      <div class="vs-open-positions">
        <div class="vs-filter-bar">
          <label class="vs-toggle-label">
            <input type="checkbox" class="vs-toggle" data-action="toggle-family-filter"
              ${this.showOnlyFamilyGroups ? "checked" : ""}>
            Show only my family's volunteer groups
          </label>
        </div>
        ${schedules.length === 0 ? `
          <div class="vs-empty">
            <p>${this.showOnlyFamilyGroups ? "No available opportunities found in your family's volunteer groups." : "No available volunteer opportunities found for your congregation."}</p>
          </div>` : ""}
        ${!hasOpenSlots && schedules.length > 0 ? `
          <div class="vs-empty"><p>All positions are currently filled.</p></div>` : ""}
        ${schedules.map((s) => this.openScheduleTpl(s, members, d.familyMemberships)).join("")}
      </div>`;
  }

  private openScheduleTpl(schedule: OpenSchedule, members: HouseholdMember[], familyMemberships: FamilyGroupMembership[]): string {
    const openRoles = schedule.roles.filter((r) => r.unfilledCount > 0);
    if (openRoles.length === 0) return "";

    const familyInGroup = familyMemberships.some((m) => m.Group_ID === schedule.Group_ID);

    return `
      <div class="vs-schedule-card">
        <div class="vs-schedule-header">
          <div>
            <div class="vs-schedule-event">${this.escHtml(schedule.Event_Title)}</div>
            <div class="vs-schedule-meta">
              ${this.escHtml(fmtDate(schedule.Event_Start_Date))}
              · ${this.escHtml(schedule.Group_Name)}
              · ${this.escHtml(schedule.Congregation_Name)}
            </div>
          </div>
          ${familyInGroup ? `<span class="vs-family-tag">Family Group</span>` : ""}
        </div>
        <div class="vs-roles-list">
          ${openRoles.map((r) => this.openRoleTpl(r, schedule, members, familyMemberships)).join("")}
        </div>
      </div>`;
  }

  private openRoleTpl(role: ScheduleRole, schedule: OpenSchedule, members: HouseholdMember[], familyMemberships: FamilyGroupMembership[]): string {
    const timeStr = role.Start_Time
      ? fmtTime(role.Start_Time) + (role.End_Time ? ` – ${fmtTime(role.End_Time)}` : "")
      : "";

    // Only members who (a) hold this group role in this group and (b) aren't already signed up
    const assignedParticipantIds = new Set(role.assignments.map((a) => a.Participant_ID));
    const eligibleMembers = members.filter(
      (m) =>
        !assignedParticipantIds.has(m.Participant_ID!) &&
        familyMemberships.some(
          (fm) =>
            fm.Participant_ID === m.Participant_ID &&
            fm.Group_ID === schedule.Group_ID &&
            fm.Group_Role_ID === role.Group_Role_ID
        )
    );

    return `
      <div class="vs-role-row">
        <div class="vs-role-info">
          <span class="vs-role-name">${this.escHtml(role.Volunteer_Role)}</span>
          ${timeStr ? `<span class="vs-role-time">${this.escHtml(timeStr)}</span>` : ""}
          <span class="vs-slots">${role.filledCount}/${role.Number_Of_Volunteers} filled · ${role.unfilledCount} open</span>
        </div>
        ${eligibleMembers.length > 0 ? `
          <div class="vs-signup-group">
            ${eligibleMembers.map((m) => `
              <button class="vs-btn vs-btn--signup"
                data-action="signup"
                data-role-id="${role.Schedule_Role_ID}"
                data-participant-id="${m.Participant_ID}">
                Sign up ${this.escHtml(m.Nickname ?? m.First_Name)}
              </button>`).join("")}
          </div>` : ""}
      </div>`;
  }

  // ── Unavailability tab ────────────────────────────────────────────────────

  private unavailableTpl(d: WidgetData): string {
    const today = new Date().toISOString().slice(0, 10);

    return `
      <div class="vs-unavailable">
        <div class="vs-add-unavailable">
          <h3 class="vs-section-title">Add Unavailable Dates</h3>
          <form class="vs-unavail-form" data-form="unavailable">
            <div class="vs-form-row">
              <label class="vs-label">Family Members</label>
              <div class="vs-member-checks">
                ${d.family.map((m) => `
                  <label class="vs-check-label">
                    <input type="checkbox" class="vs-check" name="contactIds" value="${m.Contact_ID}" checked>
                    ${this.escHtml(displayName(m))}
                    <span class="vs-check-pos">${this.escHtml(m.Household_Position)}</span>
                  </label>`).join("")}
              </div>
            </div>
            <div class="vs-form-row vs-form-row--inline">
              <div>
                <label class="vs-label" for="vs-start-date">Start Date</label>
                <input id="vs-start-date" type="date" name="startDate" class="vs-input" min="${today}" required>
              </div>
              <div>
                <label class="vs-label" for="vs-end-date">End Date</label>
                <input id="vs-end-date" type="date" name="endDate" class="vs-input" min="${today}" required>
              </div>
            </div>
            <button type="submit" class="vs-btn vs-btn--primary">Add Dates</button>
          </form>
        </div>

        <div class="vs-unavail-list">
          <h3 class="vs-section-title">Current Unavailability</h3>
          ${d.unavailableDates.length === 0
            ? `<p class="vs-empty-inline">No upcoming unavailable dates recorded.</p>`
            : this.unavailDateListTpl(d.family, d.unavailableDates)}
        </div>
      </div>`;
  }

  private unavailDateListTpl(family: HouseholdMember[], dates: UnavailableDate[]): string {
    const byContact = new Map<number, UnavailableDate[]>();
    for (const d of dates) {
      const list = byContact.get(d.Contact_ID) ?? [];
      list.push(d);
      byContact.set(d.Contact_ID, list);
    }

    return family
      .filter((m) => byContact.has(m.Contact_ID))
      .map((m) => `
        <div class="vs-member-section vs-member-section--sm">
          <div class="vs-member-header">
            <span class="vs-member-name">${this.escHtml(displayName(m))}</span>
          </div>
          ${(byContact.get(m.Contact_ID) ?? []).map((d) => `
            <div class="vs-unavail-row">
              <span class="vs-unavail-dates">
                ${this.escHtml(fmtDate(d.Start_Date))}
                ${d.Start_Date !== d.End_Date ? ` – ${this.escHtml(fmtDate(d.End_Date))}` : ""}
              </span>
              <button class="vs-btn vs-btn--remove"
                data-action="remove-unavailable"
                data-id="${d.Volunteer_Unavailable_Date_ID}"
                aria-label="Remove unavailable date">
                ✕
              </button>
            </div>`).join("")}
        </div>`).join("");
  }

  // ── My Groups tab ─────────────────────────────────────────────────────────

  private myGroupsTpl(d: WidgetData): string {
    const memberships = d.scheduleGroupMemberships ?? [];

    if (memberships.length === 0) {
      return `<div class="vs-empty"><p>No volunteer groups found for your family.</p></div>`;
    }

    // Build participant → contact map
    const participantToContact = new Map<number, HouseholdMember>(
      d.family
        .filter((m) => m.Participant_ID !== null)
        .map((m) => [m.Participant_ID as number, m])
    );

    // Group memberships by family member
    const byMember = new Map<number, { member: HouseholdMember; memberships: ScheduleGroupMembership[] }>();
    for (const mem of memberships) {
      const member = participantToContact.get(mem.Participant_ID);
      if (!member) continue;
      const entry = byMember.get(member.Contact_ID) ?? { member, memberships: [] };
      entry.memberships.push(mem);
      byMember.set(member.Contact_ID, entry);
    }

    return `
      <div class="vs-groups-list">
        ${d.family
          .filter((m) => byMember.has(m.Contact_ID))
          .map(({ Contact_ID }) => {
            const { member, memberships: mems } = byMember.get(Contact_ID)!;
            return `
              <div class="vs-member-section">
                <div class="vs-member-header">
                  <span class="vs-member-name">${this.escHtml(displayName(member))}</span>
                  <span class="vs-member-role">${this.escHtml(member.Household_Position)}</span>
                </div>
                <div class="vs-group-cards">
                  ${mems.map((mem) => `
                    <div class="vs-group-card">
                      <div class="vs-group-card-header">
                        <span class="vs-group-name">${this.escHtml(mem.Group_Name)}</span>
                        <span class="vs-group-role-badge">${this.escHtml(mem.Role_Title)}</span>
                      </div>
                      ${mem.Description ? `<p class="vs-group-desc">${this.escHtml(mem.Description)}</p>` : ""}
                    </div>`).join("")}
                </div>
              </div>`;
          }).join("")}
      </div>`;
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  private bindEvents() {
    // Tab switching
    this.root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeTab = btn.dataset.tab as typeof this.activeTab;
        this.render();
      });
    });

    // Retry button
    this.root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.addEventListener("click", () => {
      this.loadData();
    });

    // Accept / Decline positions
    this.root.querySelectorAll<HTMLButtonElement>("[data-action='accept-pos']").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.acceptPosition(parseInt(btn.dataset.id!), "accept");
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-action='decline-pos']").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.acceptPosition(parseInt(btn.dataset.id!), "decline");
      });
    });

    // Sign up
    this.root.querySelectorAll<HTMLButtonElement>("[data-action='signup']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const roleId = parseInt(btn.dataset.roleId!);
        const participantId = parseInt(btn.dataset.participantId!);
        this.signupForRole(roleId, participantId);
      });
    });

    // Show/hide declined assignments toggle
    this.root.querySelector<HTMLInputElement>("[data-action='toggle-show-declined']")?.addEventListener("change", (e) => {
      this.showDeclined = (e.target as HTMLInputElement).checked;
      this.render();
    });

    // Family group filter toggle
    this.root.querySelector<HTMLInputElement>("[data-action='toggle-family-filter']")?.addEventListener("change", (e) => {
      this.showOnlyFamilyGroups = (e.target as HTMLInputElement).checked;
      this.render();
    });

    // Add unavailable form
    this.root.querySelector<HTMLFormElement>("[data-form='unavailable']")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const contactIds = Array.from(
        form.querySelectorAll<HTMLInputElement>('input[name="contactIds"]:checked')
      ).map((cb) => parseInt(cb.value));
      const startDate = (form.elements.namedItem("startDate") as HTMLInputElement).value;
      const endDate = (form.elements.namedItem("endDate") as HTMLInputElement).value;
      if (contactIds.length > 0 && startDate && endDate) {
        this.addUnavailable(contactIds, startDate, endDate);
      }
    });

    // Auto-set end date min when start date changes
    const startInput = this.root.querySelector<HTMLInputElement>("#vs-start-date");
    const endInput = this.root.querySelector<HTMLInputElement>("#vs-end-date");
    startInput?.addEventListener("change", () => {
      if (endInput && startInput.value) {
        endInput.min = startInput.value;
        if (endInput.value && endInput.value < startInput.value) {
          endInput.value = startInput.value;
        }
      }
    });

    // Remove unavailable date
    this.root.querySelectorAll<HTMLButtonElement>("[data-action='remove-unavailable']").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.removeUnavailable(parseInt(btn.dataset.id!));
      });
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  private styles(): string {
    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .vs-widget {
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        font-size: 14px;
        color: #2D2926;
        max-width: 680px;
        background: #ffffff;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        overflow: hidden;
      }

      /* Header */
      .vs-header {
        padding: 16px 20px 12px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .vs-title { font-size: 18px; font-weight: 700; color: #004C97; flex-shrink: 0; }
      .vs-family-badges { display: flex; gap: 6px; flex-wrap: wrap; }
      .vs-badge {
        font-size: 12px;
        font-weight: 500;
        padding: 2px 10px;
        border-radius: 9999px;
        background: #e0f2fe;
        color: #0369a1;
        white-space: nowrap;
      }
      .vs-badge--pos-1 { background: #eff6ff; color: #1d4ed8; }
      .vs-badge--pos-2 { background: #f0fdf4; color: #166534; }
      .vs-badge--pos-3 { background: #fdf4ff; color: #7e22ce; }
      .vs-badge--pos-4 { background: #fff7ed; color: #c2410c; }
      .vs-badge--pos-5 { background: #f0fdf4; color: #166534; }

      /* Tabs */
      .vs-tabs {
        display: flex;
        border-bottom: 1px solid #e5e7eb;
        padding: 0 8px;
        gap: 2px;
        background: #f9fafb;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .vs-tabs::-webkit-scrollbar {
        display: none;
      }
      .vs-tab {
        padding: 10px 14px;
        border: none;
        background: transparent;
        font-size: 13px;
        font-weight: 500;
        color: #6b7280;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        flex-shrink: 0;
        transition: color 0.15s, border-color 0.15s;
      }
      .vs-tab:hover { color: #004C97; }
      .vs-tab--active { color: #004C97; border-bottom-color: #004C97; }
      .vs-count-badge {
        background: #ef4444;
        color: white;
        font-size: 11px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 9999px;
        min-width: 18px;
        text-align: center;
      }

      /* Panel */
      .vs-panel { padding: 16px 20px; }

      /* Loading / Error */
      .vs-loading, .vs-error {
        padding: 40px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        color: #6b7280;
        text-align: center;
      }
      .vs-spinner {
        width: 28px; height: 28px;
        border: 3px solid #e5e7eb;
        border-top-color: #004C97;
        border-radius: 50%;
        animation: vs-spin 0.8s linear infinite;
      }
      @keyframes vs-spin { to { transform: rotate(360deg); } }
      .vs-error-msg { color: #dc2626; }

      /* Empty state */
      .vs-empty { padding: 24px; text-align: center; color: #9ca3af; }
      .vs-empty-inline { color: #9ca3af; font-style: italic; font-size: 13px; }

      /* Member sections */
      .vs-member-section { margin-bottom: 20px; }
      .vs-member-section--sm { margin-bottom: 14px; }
      .vs-member-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid #f3f4f6;
      }
      .vs-member-name { font-weight: 600; color: #002855; }
      .vs-member-role { font-size: 12px; color: #6b7280; background: #f3f4f6; padding: 1px 8px; border-radius: 9999px; }

      /* Weekend groups */
      .vs-weekend-group { margin-bottom: 12px; }
      .vs-weekend-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }

      /* Position cards */
      .vs-position-card {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 10px 14px;
        margin-bottom: 6px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .vs-position-card--pending { border-left: 3px solid #f59e0b; }
      .vs-position-title { font-weight: 600; font-size: 14px; color: #111827; margin-bottom: 3px; }
      .vs-position-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 2px; }
      .vs-position-role { font-weight: 500; color: #004C97; font-size: 13px; }
      .vs-position-time { color: #6b7280; font-size: 12px; }
      .vs-position-detail { font-size: 12px; color: #9ca3af; }
      .vs-position-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }

      /* Status badges */
      .vs-status {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 9999px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .vs-status--accepted { background: #dcfce7; color: #166534; }
      .vs-status--awaiting { background: #fef3c7; color: #92400e; }
      .vs-status--declined { background: #fee2e2; color: #991b1b; }

      /* Schedule cards (available opportunities) */
      .vs-schedule-card {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        margin-bottom: 14px;
        overflow: hidden;
      }
      .vs-schedule-header {
        padding: 12px 16px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      .vs-schedule-event { font-weight: 600; font-size: 14px; color: #111827; margin-bottom: 2px; }
      .vs-schedule-meta { font-size: 12px; color: #6b7280; }
      .vs-family-tag { font-size: 11px; font-weight: 600; padding: 2px 8px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 9999px; white-space: nowrap; }
      .vs-roles-list { padding: 8px 0; }
      .vs-role-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 16px;
        border-bottom: 1px solid #f3f4f6;
        flex-wrap: wrap;
      }
      .vs-role-row:last-child { border-bottom: none; }
      .vs-role-info { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .vs-role-name { font-weight: 500; color: #111827; }
      .vs-role-time { color: #6b7280; font-size: 12px; }
      .vs-slots { font-size: 12px; color: #9ca3af; }
      .vs-signup-group { display: flex; gap: 6px; flex-wrap: wrap; }

      /* Filter bar */
      .vs-filter-bar { margin-bottom: 14px; }
      .vs-toggle-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #374151; cursor: pointer; }
      .vs-toggle { accent-color: #004C97; width: 15px; height: 15px; cursor: pointer; }

      /* Unavailability */
      .vs-add-unavailable { margin-bottom: 24px; }
      .vs-section-title { font-size: 15px; font-weight: 600; color: #002855; margin-bottom: 12px; }
      .vs-unavail-form { display: flex; flex-direction: column; gap: 12px; }
      .vs-form-row { display: flex; flex-direction: column; gap: 4px; }
      .vs-form-row--inline { flex-direction: row; gap: 12px; }
      .vs-form-row--inline > div { flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .vs-label { font-size: 12px; font-weight: 500; color: #374151; }
      .vs-input, .vs-select {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 13px;
        color: #111827;
        background: #fff;
        width: 100%;
      }
      .vs-input:focus, .vs-select:focus { outline: none; border-color: #004C97; box-shadow: 0 0 0 2px rgba(0,76,151,0.15); }
      .vs-member-checks { display: flex; flex-direction: column; gap: 6px; }
      .vs-check-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; color: #374151; cursor: pointer;
        padding: 5px 8px; border-radius: 6px;
      }
      .vs-check-label:hover { background: #f3f4f6; }
      .vs-check { accent-color: #004C97; width: 15px; height: 15px; cursor: pointer; flex-shrink: 0; }
      .vs-check-pos { font-size: 11px; color: #9ca3af; margin-left: 2px; }
      .vs-unavail-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #f3f4f6;
        gap: 12px;
      }
      .vs-unavail-row:last-child { border-bottom: none; }
      .vs-unavail-dates { font-size: 13px; color: #374151; }

      /* Buttons */
      .vs-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 12px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        transition: background 0.15s, opacity 0.15s;
        white-space: nowrap;
      }
      .vs-btn--primary { background: #004C97; color: #fff; font-size: 13px; padding: 8px 16px; }
      .vs-btn--primary:hover { background: #003d7a; }
      .vs-btn--accept { background: #dcfce7; color: #166534; }
      .vs-btn--accept:hover { background: #bbf7d0; }
      .vs-btn--decline { background: #fee2e2; color: #991b1b; }
      .vs-btn--decline:hover { background: #fecaca; }
      .vs-btn--signup { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 12px; padding: 4px 10px; }
      .vs-btn--signup:hover { background: #dbeafe; }
      .vs-btn--remove { background: transparent; color: #9ca3af; font-size: 14px; padding: 2px 6px; border: none; }
      .vs-btn--remove:hover { color: #ef4444; }

      /* My Groups */
      .vs-groups-list {}
      .vs-group-cards { display: flex; flex-direction: column; gap: 8px; }
      .vs-group-card {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 10px 14px;
      }
      .vs-group-card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 4px;
      }
      .vs-group-card-header:last-child { margin-bottom: 0; }
      .vs-group-name { font-weight: 600; font-size: 14px; color: #111827; }
      .vs-group-role-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 9999px;
        background: #eff6ff;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
        white-space: nowrap;
      }
      .vs-group-desc { font-size: 12px; color: #6b7280; line-height: 1.4; }

      /* Toast */
      .vs-toast {
        position: sticky;
        bottom: 12px;
        margin: 8px 20px 8px;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
      }
      .vs-toast--visible { opacity: 1; pointer-events: auto; }
      .vs-toast--ok { background: #dcfce7; color: #166534; }
      .vs-toast--error { background: #fee2e2; color: #991b1b; }
    `;
  }

  private escHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  }
}

if (!customElements.get("next-volunteer-schedule")) {
  customElements.define("next-volunteer-schedule", VolunteerScheduleWidget);
}
