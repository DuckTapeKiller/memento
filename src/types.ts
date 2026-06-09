/* ================================================================= */
/* Types for Memento - Obsidian Calendar Events Plugin                */
/* ================================================================= */

export interface MementoEvent {
  id: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm" (24-hour format)
  title: string;
  context: string; // description / context
  recurrence: RecurrenceType;
  createdAt: string; // ISO timestamp
}

export type RecurrenceType = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface MementoSettings {
  events: MementoEvent[];
  timelineViewMode: "all" | "month";
  showPastEventsInSettings: boolean;
  eventNoteFolder: string;
  frontmatterLanguage: "en" | "es";
}

export const DEFAULT_SETTINGS: MementoSettings = {
  events: [],
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
  if (h === undefined || m === undefined) return time;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Get today's date as "YYYY-MM-DD"
 */
export function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

/**
 * Check if a date string is today or in the future
 */
export function isActiveDate(dateStr: string): boolean {
  const today = getTodayStr();
  return dateStr >= today;
}

/**
 * Generate occurrences of a recurring event within a date range.
 * Returns array of date strings "YYYY-MM-DD" that fall within [startRange, endRange].
 */
export function getRecurrenceOccurrences(
  event: MementoEvent,
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

  // Start from the event's original date or the range start, whichever is later
  let current = new Date(eventDate);

  // For recurrence types, advance `current` to be at or after rangeStart
  while (current < rangeStart) {
    current = advanceDate(current, event.recurrence, eventDate);
  }

  // Generate occurrences up to rangeEnd
  const maxIterations = 366; // safety limit
  let iterations = 0;
  while (current <= rangeEnd && iterations < maxIterations) {
    const dateStr = dateToStr(current);
    occurrences.push(dateStr);
    current = advanceDate(current, event.recurrence, eventDate);
    iterations++;
  }

  return occurrences;
}

function advanceDate(
  current: Date,
  recurrence: RecurrenceType,
  originalDate: Date,
): Date {
  const next = new Date(current);
  switch (recurrence) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly": {
      const origDay = originalDate.getDate();
      next.setMonth(next.getMonth() + 1);
      // Handle months with fewer days (e.g., Jan 31 → Feb 28)
      if (next.getDate() !== origDay) {
        next.setDate(0); // Go to last day of previous month
      }
      break;
    }
    case "yearly": {
      next.setFullYear(next.getFullYear() + 1);
      // Handle leap year (Feb 29)
      const origDay2 = originalDate.getDate();
      if (next.getDate() !== origDay2) {
        next.setDate(0);
      }
      break;
    }
    default:
      // 'none' — should not be called
      next.setFullYear(next.getFullYear() + 100);
      break;
  }
  return next;
}

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

/**
 * Represents a single occurrence of an event in the timeline
 */
export interface TimelineEntry {
  event: MementoEvent;
  occurrenceDate: string; // "YYYY-MM-DD"
}

/**
 * Get all timeline entries (active event occurrences) sorted by date and time.
 */
export function getTimelineEntries(
  events: MementoEvent[],
  viewMode: "all" | "month",
): TimelineEntry[] {
  const today = getTodayStr();

  // Calculate boundaries based on view mode
  let startDateStr = today;
  let endDateStr: string;

  if (viewMode === "month") {
    // Current month boundaries
    const d = new Date();
    // Start of month (or today, whichever is later)
    // Actually, for a timeline, usually we show from today onwards, up to end of month
    d.setDate(1);
    const monthStartStr = dateToStr(d);
    startDateStr = today > monthStartStr ? today : monthStartStr;

    // End of month
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    endDateStr = dateToStr(d);
  } else {
    // "all" mode: look ahead up to 2 years for recurring events to avoid infinite loops
    // one-time events will be included fully
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    endDateStr = dateToStr(d);
  }

  const entries: TimelineEntry[] = [];

  for (const event of events) {
    if (event.recurrence === "none") {
      if (
        event.date >= startDateStr &&
        (viewMode === "all" || event.date <= endDateStr)
      ) {
        entries.push({ event, occurrenceDate: event.date });
      }
    } else {
      const occurrences = getRecurrenceOccurrences(
        event,
        startDateStr,
        endDateStr,
      );
      for (const date of occurrences) {
        entries.push({ event, occurrenceDate: date });
      }
    }
  }

  // Sort by date, then by time
  entries.sort((a, b) => {
    const dateCmp = a.occurrenceDate.localeCompare(b.occurrenceDate);
    if (dateCmp !== 0) return dateCmp;
    return a.event.time.localeCompare(b.event.time);
  });

  return entries;
}

/**
 * Get a Set of all dates that have events (for calendar decoration).
 * Looks ahead the specified number of days from today.
 */
export function getEventDatesSet(
  events: MementoEvent[],
  lookaheadDays: number,
): Set<string> {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + lookaheadDays);
  const endStr = dateToStr(endDate);

  // Also look at the current displayed month range (past dates for borders)
  const startDate = new Date();
  startDate.setDate(1);
  startDate.setMonth(startDate.getMonth() - 1);
  const startStr = dateToStr(startDate);

  const dates = new Set<string>();

  for (const event of events) {
    const occurrences = getRecurrenceOccurrences(event, startStr, endStr);
    for (const date of occurrences) {
      dates.add(date);
    }
  }

  return dates;
}
