/* ================================================================= */
/* Types for Memento - Obsidian Calendar Events Plugin                */
/* ================================================================= */

export type RecurrenceType = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type EventStatus = "active" | "completed" | "archived";
export type TimelineViewMode = "all" | "month";
export type TimelineSourceFilter = "all" | "memento" | "external";
export type TimelineDateRange = "upcoming" | "week" | "month" | "all";
export type PendingCountWindow = "today" | "week" | "month" | "all";

export interface MementoEvent {
  id: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm" (24-hour format)
  endDate?: string;
  endTime?: string;
  title: string;
  context: string; // description / context
  recurrence: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceEndDate?: string;
  recurrenceCount?: number;
  status?: EventStatus;
  notePaths?: Record<string, string>;
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
}

export interface ExternalCalendarSource {
  id: string;
  name: string;
  type: "ics";
  url: string;
  enabled: boolean;
  color?: string;
  refreshIntervalMinutes: number;
  lastFetchedAt?: string;
  lastError?: string;
}

export interface ExternalCalendarEvent {
  id: string;
  sourceId: string;
  externalUid: string;
  title: string;
  context: string;
  location?: string;
  url?: string;
  date: string;
  time: string;
  endDate?: string;
  endTime?: string;
  allDay: boolean;
  recurrence: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceEndDate?: string;
  recurrenceCount?: number;
  notePaths?: Record<string, string>;
  lastSeenAt: string;
}

export interface TimelineFilters {
  search: string;
  source: TimelineSourceFilter;
  sourceId: string;
  dateRange: TimelineDateRange;
  includeCompleted: boolean;
  includeArchived: boolean;
}

export interface MementoSettings {
  events: MementoEvent[];
  externalCalendarSources: ExternalCalendarSource[];
  externalEventsCache: ExternalCalendarEvent[];
  hiddenExternalEventIds: string[];
  timelineFilters: TimelineFilters;
  timelineViewMode: TimelineViewMode;
  showPastEventsInSettings: boolean;
  eventNoteFolder: string;
  frontmatterLanguage: "en" | "es";
  openTimelineOnStartup: boolean;
  showStatusBarCount: boolean;
  showRibbonBadge: boolean;
  pendingCountWindow: PendingCountWindow;
  pendingIncludeOverdue: boolean;
}

export const DEFAULT_TIMELINE_FILTERS: TimelineFilters = {
  search: "",
  source: "all",
  sourceId: "",
  dateRange: "upcoming",
  includeCompleted: false,
  includeArchived: false,
};

export const DEFAULT_SETTINGS: MementoSettings = {
  events: [],
  externalCalendarSources: [],
  externalEventsCache: [],
  hiddenExternalEventIds: [],
  timelineFilters: DEFAULT_TIMELINE_FILTERS,
  timelineViewMode: "all",
  showPastEventsInSettings: false,
  eventNoteFolder: "",
  frontmatterLanguage: "en",
  openTimelineOnStartup: false,
  showStatusBarCount: true,
  showRibbonBadge: true,
  pendingCountWindow: "today",
  pendingIncludeOverdue: false,
};

export const VIEW_TYPE_TIMELINE = "memento-timeline";

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: "One-time",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export interface TimelineEntry {
  id: string;
  sourceType: "memento" | "external";
  sourceId: string;
  sourceName: string;
  event: MementoEvent | ExternalCalendarEvent;
  occurrenceDate: string; // "YYYY-MM-DD"
  occurrenceTime: string; // "HH:mm"
  editable: boolean;
}

/**
 * Generate a simple UUID v4
 */
export function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Format a date string "YYYY-MM-DD" into a human-readable string
 */
export function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const mainDate = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const weekday = date.toLocaleDateString(undefined, {
    weekday: "long",
  });
  return `${mainDate} (${weekday})`;
}

/**
 * Format time "HH:mm" into 12-hour display
 */
export function formatTimeDisplay(time: string): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m))
    return time;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Get today's date as "YYYY-MM-DD"
 */
export function getTodayStr(): string {
  return dateToStr(new Date());
}

/**
 * Check if a date string is today or in the future
 */
export function isActiveDate(dateStr: string): boolean {
  const today = getTodayStr();
  return dateStr >= today;
}

export function normalizeEvent(event: MementoEvent): MementoEvent {
  return {
    ...event,
    recurrence: event.recurrence || "none",
    recurrenceInterval: Math.max(1, event.recurrenceInterval || 1),
    status: event.status || "active",
    notePaths: event.notePaths || {},
    updatedAt: event.updatedAt || event.createdAt,
  };
}

export function getRecurrenceLabel(event: {
  recurrence: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceEndDate?: string;
  recurrenceCount?: number;
}): string {
  if (event.recurrence === "none") return RECURRENCE_LABELS.none;
  const interval = Math.max(1, event.recurrenceInterval || 1);
  const unitLabels: Record<Exclude<RecurrenceType, "none">, string> = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  };
  const base =
    interval === 1
      ? RECURRENCE_LABELS[event.recurrence]
      : `Every ${interval} ${unitLabels[event.recurrence]}${interval > 1 ? "s" : ""}`;

  if (event.recurrenceEndDate) return `${base} until ${event.recurrenceEndDate}`;
  if (event.recurrenceCount) return `${base} (${event.recurrenceCount} times)`;
  return base;
}

/**
 * Generate occurrences of a recurring event within a date range.
 * Returns array of date strings "YYYY-MM-DD" that fall within [startRange, endRange].
 */
export function getRecurrenceOccurrences(
  event: {
    date: string;
    recurrence: RecurrenceType;
    recurrenceInterval?: number;
    recurrenceEndDate?: string;
    recurrenceCount?: number;
  },
  startRange: string,
  endRange: string,
  maxOccurrences = 1500,
): string[] {
  if (event.recurrence === "none") {
    if (event.date >= startRange && event.date <= endRange) {
      return [event.date];
    }
    return [];
  }

  const eventDate = new Date(event.date + "T00:00:00");
  const rangeStart = new Date(startRange + "T00:00:00");
  const rangeEnd = new Date(endRange + "T00:00:00");
  if (
    Number.isNaN(eventDate.getTime()) ||
    Number.isNaN(rangeStart.getTime()) ||
    Number.isNaN(rangeEnd.getTime())
  ) {
    return [];
  }

  const recurrenceEnd = event.recurrenceEndDate
    ? new Date(event.recurrenceEndDate + "T00:00:00")
    : null;
  const interval = Math.max(1, event.recurrenceInterval || 1);

  const occurrences: string[] = [];
  let step = firstStepOnOrAfter(eventDate, event.recurrence, interval, rangeStart);
  if (event.recurrenceCount && step >= event.recurrenceCount) return [];

  const maxIterations = Math.max(1, maxOccurrences);
  for (let i = 0; i < maxIterations; i++) {
    if (event.recurrenceCount && step >= event.recurrenceCount) break;
    const current = occurrenceAt(eventDate, event.recurrence, interval, step);
    if (current > rangeEnd) break;
    if (recurrenceEnd && current > recurrenceEnd) break;
    if (current >= rangeStart) occurrences.push(dateToStr(current));
    step++;
  }

  return occurrences;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * The nth occurrence of a recurring event, always derived from the original
 * start date rather than from the previous occurrence.
 *
 * Stepping cumulatively let a monthly event starting on the 29th, 30th or 31st
 * reach a fixed point — Feb 28 advances to Mar 28, fails the "same day of
 * month" check and clamps straight back to Feb 28 — so the date stopped moving
 * and the catch-up loop span forever. Deriving each occurrence from the
 * original date keeps the sequence strictly increasing and gives the intended
 * calendar semantics: Jan 31 -> Feb 28 -> Mar 31.
 */
function occurrenceAt(
  originalDate: Date,
  recurrence: RecurrenceType,
  interval: number,
  step: number,
): Date {
  const next = new Date(originalDate);
  switch (recurrence) {
    case "daily":
      next.setDate(next.getDate() + interval * step);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7 * interval * step);
      break;
    case "monthly": {
      const day = originalDate.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + interval * step);
      next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
      break;
    }
    case "yearly": {
      const day = originalDate.getDate();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + interval * step);
      next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
      break;
    }
    default:
      next.setFullYear(next.getFullYear() + 100 * step);
      break;
  }
  return next;
}

/**
 * First step index whose occurrence lands on or after rangeStart, computed
 * arithmetically. Walking there one occurrence at a time made an event dated
 * far in the past cost hundreds of thousands of iterations on every timeline
 * refresh, status bar update and calendar decoration pass.
 */
function firstStepOnOrAfter(
  originalDate: Date,
  recurrence: RecurrenceType,
  interval: number,
  rangeStart: Date,
): number {
  if (originalDate >= rangeStart) return 0;

  const msPerDay = 24 * 60 * 60 * 1000;
  const elapsedMs = rangeStart.getTime() - originalDate.getTime();
  let estimate: number;

  switch (recurrence) {
    case "daily":
      estimate = Math.floor(elapsedMs / msPerDay / interval);
      break;
    case "weekly":
      estimate = Math.floor(elapsedMs / (msPerDay * 7) / interval);
      break;
    case "monthly": {
      const months =
        (rangeStart.getFullYear() - originalDate.getFullYear()) * 12 +
        (rangeStart.getMonth() - originalDate.getMonth());
      estimate = Math.floor(months / interval);
      break;
    }
    case "yearly":
      estimate = Math.floor(
        (rangeStart.getFullYear() - originalDate.getFullYear()) / interval,
      );
      break;
    default:
      return 0;
  }

  // Start a little short of the estimate, then close the gap exactly: DST
  // shifts and end-of-month clamping can move an occurrence by a day.
  let step = Math.max(0, estimate - 2);
  let guard = 0;
  while (
    occurrenceAt(originalDate, recurrence, interval, step) < rangeStart &&
    guard < 400
  ) {
    step++;
    guard++;
  }

  return step;
}

export function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return dateToStr(d);
}

/** Sentinel start date meaning "no lower bound" for the All date range. */
export const ALL_DATES_START = "0000-01-01";

export function getTimelineRange(
  viewMode: TimelineViewMode,
  filters: TimelineFilters = DEFAULT_TIMELINE_FILTERS,
): { startDate: string; endDate: string } {
  const today = getTodayStr();
  const startDate = filters.dateRange === "all" ? ALL_DATES_START : today;
  let endDate: string;

  if (filters.dateRange === "week") {
    endDate = addDays(today, 7);
  } else if (filters.dateRange === "month" || viewMode === "month") {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    endDate = dateToStr(d);
  } else {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    endDate = dateToStr(d);
  }

  return { startDate, endDate };
}

/**
 * Get all timeline entries sorted by date and time.
 */
/**
 * Date spans tried, in order, before falling back to the filter's full range.
 * A dense calendar is satisfied by the first window, so the timeline never pays
 * to expand two years of daily recurrences just to show the next screenful.
 */
const TIMELINE_WINDOW_STEPS_DAYS = [30, 180, 730];

/**
 * Timeline entries sorted by date and time.
 *
 * `limit` bounds the work, not just the output: expanding every occurrence in
 * range and slicing afterwards meant 500 daily events over "All upcoming" built
 * 750,000 entries on every keystroke. Because each event's occurrences come out
 * in ascending order, the globally earliest `limit` entries can never need more
 * than `limit` occurrences from any single event — so both the per-event
 * expansion and the search window can be capped without changing the result.
 */
export function getTimelineEntries(
  events: MementoEvent[],
  viewMode: TimelineViewMode,
  externalEvents: ExternalCalendarEvent[] = [],
  filters: TimelineFilters = DEFAULT_TIMELINE_FILTERS,
  externalSources: ExternalCalendarSource[] = [],
  hiddenExternalEventIds: string[] = [],
  limit = 0,
): { entries: TimelineEntry[]; hasMore: boolean } {
  const { startDate, endDate } = getTimelineRange(viewMode, filters);
  const collect = (rangeEnd: string) =>
    collectTimelineEntries(
      events,
      externalEvents,
      filters,
      externalSources,
      hiddenExternalEventIds,
      startDate,
      rangeEnd,
      limit > 0 ? limit : 1500,
    );

  if (limit > 0 && startDate !== ALL_DATES_START) {
    for (const days of TIMELINE_WINDOW_STEPS_DAYS) {
      const windowEnd = addDays(startDate, days);
      if (windowEnd >= endDate) break;
      const windowed = collect(windowEnd);
      if (windowed.length > limit) {
        return { entries: windowed.slice(0, limit), hasMore: true };
      }
    }
  }

  const all = collect(endDate);
  if (limit > 0 && all.length > limit) {
    return { entries: all.slice(0, limit), hasMore: true };
  }
  return { entries: all, hasMore: false };
}

function collectTimelineEntries(
  events: MementoEvent[],
  externalEvents: ExternalCalendarEvent[],
  filters: TimelineFilters,
  externalSources: ExternalCalendarSource[],
  hiddenExternalEventIds: string[],
  startDate: string,
  endDate: string,
  perEventLimit: number,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const rawEvent of events) {
    const event = normalizeEvent(rawEvent);
    if (!shouldShowManualEvent(event, filters)) continue;

    const occurrences = getRecurrenceOccurrences(
      event,
      startDate,
      endDate,
      perEventLimit,
    );
    for (const date of occurrences) {
      entries.push({
        id: `${event.id}:${date}`,
        sourceType: "memento",
        sourceId: "memento",
        sourceName: "Memento",
        event,
        occurrenceDate: date,
        occurrenceTime: event.time,
        editable: true,
      });
    }
  }

  const enabledSourceIds = new Set(
    externalSources.filter((source) => source.enabled).map((source) => source.id),
  );

  for (const event of externalEvents) {
    if (hiddenExternalEventIds.includes(event.id)) continue;
    if (!enabledSourceIds.has(event.sourceId)) continue;
    if (!shouldShowExternalEvent(event, filters)) continue;

    const source = externalSources.find((item) => item.id === event.sourceId);
    const occurrences = getRecurrenceOccurrences(
      event,
      startDate,
      endDate,
      perEventLimit,
    );
    for (const date of occurrences) {
      entries.push({
        id: `${event.id}:${date}`,
        sourceType: "external",
        sourceId: event.sourceId,
        sourceName: source?.name || "External calendar",
        event,
        occurrenceDate: date,
        occurrenceTime: event.time,
        editable: false,
      });
    }
  }

  entries.sort((a, b) => {
    const dateCmp = a.occurrenceDate.localeCompare(b.occurrenceDate);
    if (dateCmp !== 0) return dateCmp;
    return a.occurrenceTime.localeCompare(b.occurrenceTime);
  });

  return entries;
}

function shouldShowManualEvent(
  event: MementoEvent,
  filters: TimelineFilters,
): boolean {
  if (filters.source === "external") return false;
  if (filters.sourceId && filters.sourceId !== "memento") return false;
  if (event.status === "completed" && !filters.includeCompleted) return false;
  if (event.status === "archived" && !filters.includeArchived) return false;
  return matchesSearch(event, filters.search);
}

function shouldShowExternalEvent(
  event: ExternalCalendarEvent,
  filters: TimelineFilters,
): boolean {
  if (filters.source === "memento") return false;
  if (filters.sourceId && filters.sourceId !== event.sourceId) return false;
  return matchesSearch(event, filters.search);
}

function matchesSearch(
  event: { title: string; context: string; location?: string },
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = `${event.title} ${event.context} ${event.location || ""}`.toLowerCase();
  return haystack.includes(trimmed);
}

/**
 * Get a Set of all dates that have events (for calendar decoration).
 * Looks ahead the specified number of days from today.
 */
export function getEventDatesSet(
  events: MementoEvent[],
  lookaheadDays: number,
  externalEvents: ExternalCalendarEvent[] = [],
  externalSources: ExternalCalendarSource[] = [],
  hiddenExternalEventIds: string[] = [],
): Set<string> {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + lookaheadDays);
  const endStr = dateToStr(endDate);

  const startDate = new Date();
  startDate.setDate(1);
  startDate.setMonth(startDate.getMonth() - 1);
  const startStr = dateToStr(startDate);

  const dates = new Set<string>();
  const enabledSourceIds = new Set(
    externalSources.filter((source) => source.enabled).map((source) => source.id),
  );

  for (const rawEvent of events) {
    const event = normalizeEvent(rawEvent);
    if (event.status === "archived" || event.status === "completed") continue;
    const occurrences = getRecurrenceOccurrences(event, startStr, endStr);
    for (const date of occurrences) {
      dates.add(date);
    }
  }

  for (const event of externalEvents) {
    if (hiddenExternalEventIds.includes(event.id)) continue;
    if (!enabledSourceIds.has(event.sourceId)) continue;
    const occurrences = getRecurrenceOccurrences(event, startStr, endStr);
    for (const date of occurrences) {
      dates.add(date);
    }
  }

  return dates;
}

function isDateString(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Statuses the timeline hides by default. Mirrors shouldShowManualEvent so an
 * unrecognised status behaves identically in the count and in the timeline.
 */
function isHiddenStatus(status: EventStatus | undefined): boolean {
  return status === "completed" || status === "archived";
}

export interface PendingCountOptions {
  events: MementoEvent[];
  externalEvents?: ExternalCalendarEvent[];
  externalSources?: ExternalCalendarSource[];
  hiddenExternalEventIds?: string[];
  countWindow: PendingCountWindow;
  includeOverdue: boolean;
  now?: Date;
}

/**
 * End of the range a pending count looks at, as "YYYY-MM-DD".
 */
function getPendingRangeEnd(countWindow: PendingCountWindow, now: Date): string {
  const todayStr = dateToStr(now);
  switch (countWindow) {
    case "today":
      return todayStr;
    case "week":
      return addDays(todayStr, 7);
    case "month":
      return addDays(todayStr, 30);
    default: {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() + 2);
      return dateToStr(d);
    }
  }
}

/**
 * Entries counted as "pending" for the status bar / ribbon badge.
 *
 * Deliberately independent of the timeline's saved filters: a leftover search
 * term or source filter must never change the number shown on the indicator.
 * Completed and archived events are always excluded, as are hidden external
 * events and events from disabled sources.
 *
 * Overdue only ever covers one-time Memento events plus occurrences earlier
 * today whose time has passed. Recurring events always have a next occurrence,
 * and external feeds carry their own history, so neither is treated as overdue.
 */
export function getPendingEntries({
  events,
  externalEvents = [],
  externalSources = [],
  hiddenExternalEventIds = [],
  countWindow,
  includeOverdue,
  now = new Date(),
}: PendingCountOptions): TimelineEntry[] {
  const todayStr = dateToStr(now);
  const nowTime = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const endDate = getPendingRangeEnd(countWindow, now);
  const entries: TimelineEntry[] = [];

  const hasPassedToday = (date: string, time: string): boolean =>
    date === todayStr && !!time && time < nowTime;

  for (const rawEvent of events) {
    const event = normalizeEvent(rawEvent);
    if (isHiddenStatus(event.status)) continue;

    for (const date of getRecurrenceOccurrences(event, todayStr, endDate)) {
      if (!includeOverdue && hasPassedToday(date, event.time)) continue;
      entries.push({
        id: `${event.id}:${date}`,
        sourceType: "memento",
        sourceId: "memento",
        sourceName: "Memento",
        event,
        occurrenceDate: date,
        occurrenceTime: event.time,
        editable: true,
      });
    }
  }

  const enabledSourceIds = new Set(
    externalSources.filter((source) => source.enabled).map((source) => source.id),
  );

  for (const event of externalEvents) {
    if (hiddenExternalEventIds.includes(event.id)) continue;
    if (!enabledSourceIds.has(event.sourceId)) continue;

    const source = externalSources.find((item) => item.id === event.sourceId);
    for (const date of getRecurrenceOccurrences(event, todayStr, endDate)) {
      if (!includeOverdue && hasPassedToday(date, event.time)) continue;
      entries.push({
        id: `${event.id}:${date}`,
        sourceType: "external",
        sourceId: event.sourceId,
        sourceName: source?.name || "External calendar",
        event,
        occurrenceDate: date,
        occurrenceTime: event.time,
        editable: false,
      });
    }
  }

  if (includeOverdue) {
    for (const rawEvent of events) {
      const event = normalizeEvent(rawEvent);
      if (isHiddenStatus(event.status)) continue;
      if (event.recurrence !== "none") continue;
      // A malformed date must not read as "long overdue": "" and undefined
      // both compare below today, which would pin a broken event to the badge.
      if (!isDateString(event.date)) continue;
      if (event.date >= todayStr) continue;
      entries.push({
        id: `${event.id}:${event.date}`,
        sourceType: "memento",
        sourceId: "memento",
        sourceName: "Memento",
        event,
        occurrenceDate: event.date,
        occurrenceTime: event.time,
        editable: true,
      });
    }
  }

  entries.sort((a, b) => {
    const dateCmp = a.occurrenceDate.localeCompare(b.occurrenceDate);
    if (dateCmp !== 0) return dateCmp;
    return a.occurrenceTime.localeCompare(b.occurrenceTime);
  });

  return entries;
}
