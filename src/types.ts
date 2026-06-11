/* ================================================================= */
/* Types for Memento - Obsidian Calendar Events Plugin                */
/* ================================================================= */

export type RecurrenceType = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type EventStatus = "active" | "completed" | "archived";
export type TimelineViewMode = "all" | "month";
export type TimelineSourceFilter = "all" | "memento" | "external";
export type TimelineDateRange = "upcoming" | "week" | "month" | "all";

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
): string[] {
  if (event.recurrence === "none") {
    if (event.date >= startRange && event.date <= endRange) {
      return [event.date];
    }
    return [];
  }

  const occurrences: string[] = [];
  const eventDate = new Date(event.date + "T00:00:00");
  const rangeStart = new Date(startRange + "T00:00:00");
  const rangeEnd = new Date(endRange + "T00:00:00");
  const recurrenceEnd = event.recurrenceEndDate
    ? new Date(event.recurrenceEndDate + "T00:00:00")
    : null;
  const interval = Math.max(1, event.recurrenceInterval || 1);

  let current = new Date(eventDate);
  let generatedCount = 0;

  while (current < rangeStart) {
    generatedCount++;
    if (event.recurrenceCount && generatedCount >= event.recurrenceCount) {
      return [];
    }
    current = advanceDate(current, event.recurrence, eventDate, interval);
  }

  const maxIterations = 1500;
  let iterations = 0;
  while (current <= rangeEnd && iterations < maxIterations) {
    if (recurrenceEnd && current > recurrenceEnd) break;
    generatedCount++;
    if (!event.recurrenceCount || generatedCount <= event.recurrenceCount) {
      occurrences.push(dateToStr(current));
    }
    if (event.recurrenceCount && generatedCount >= event.recurrenceCount) break;
    current = advanceDate(current, event.recurrence, eventDate, interval);
    iterations++;
  }

  return occurrences;
}

function advanceDate(
  current: Date,
  recurrence: RecurrenceType,
  originalDate: Date,
  interval: number,
): Date {
  const next = new Date(current);
  switch (recurrence) {
    case "daily":
      next.setDate(next.getDate() + interval);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7 * interval);
      break;
    case "monthly": {
      const origDay = originalDate.getDate();
      next.setMonth(next.getMonth() + interval);
      if (next.getDate() !== origDay) {
        next.setDate(0);
      }
      break;
    }
    case "yearly": {
      const origDay = originalDate.getDate();
      next.setFullYear(next.getFullYear() + interval);
      if (next.getDate() !== origDay) {
        next.setDate(0);
      }
      break;
    }
    default:
      next.setFullYear(next.getFullYear() + 100);
      break;
  }
  return next;
}

export function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return dateToStr(d);
}

export function getTimelineRange(
  viewMode: TimelineViewMode,
  filters: TimelineFilters = DEFAULT_TIMELINE_FILTERS,
): { startDate: string; endDate: string } {
  const today = getTodayStr();
  const startDate = filters.dateRange === "all" ? "0000-01-01" : today;
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
export function getTimelineEntries(
  events: MementoEvent[],
  viewMode: TimelineViewMode,
  externalEvents: ExternalCalendarEvent[] = [],
  filters: TimelineFilters = DEFAULT_TIMELINE_FILTERS,
  externalSources: ExternalCalendarSource[] = [],
  hiddenExternalEventIds: string[] = [],
): TimelineEntry[] {
  const { startDate, endDate } = getTimelineRange(viewMode, filters);
  const entries: TimelineEntry[] = [];

  for (const rawEvent of events) {
    const event = normalizeEvent(rawEvent);
    if (!shouldShowManualEvent(event, filters)) continue;

    const occurrences = getRecurrenceOccurrences(event, startDate, endDate);
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
    const occurrences = getRecurrenceOccurrences(event, startDate, endDate);
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
