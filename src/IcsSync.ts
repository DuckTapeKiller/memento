import { requestUrl } from "obsidian";
import {
  ExternalCalendarEvent,
  ExternalCalendarSource,
  RecurrenceType,
  dateToStr,
  generateId,
} from "./types";

interface IcsEventData {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  dtstart: string;
  dtstartTzid: string;
  dtend: string;
  dtendTzid: string;
  rrule: string;
}

export interface CalendarSyncResult {
  source: ExternalCalendarSource;
  events: ExternalCalendarEvent[];
}

export async function syncExternalCalendarSource(
  source: ExternalCalendarSource,
  existingEvents: ExternalCalendarEvent[],
): Promise<CalendarSyncResult> {
  const response = await requestUrl({ url: source.url });
  const seenAt = new Date().toISOString();
  const existingByUid = new Map(
    existingEvents
      .filter((event) => event.sourceId === source.id)
      .map((event) => [event.externalUid, event]),
  );
  const parsed = parseIcs(response.text, source.id, seenAt, existingByUid);

  return {
    source: {
      ...source,
      lastFetchedAt: seenAt,
      lastError: "",
    },
    events: parsed,
  };
}

export function parseIcs(
  icsText: string,
  sourceId: string,
  seenAt: string,
  existingByUid: Map<string, ExternalCalendarEvent> = new Map(),
): ExternalCalendarEvent[] {
  const lines = unfoldIcsLines(icsText);
  const rawEvents: IcsEventData[] = [];
  let current: Partial<IcsEventData> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.dtstart) {
        const data: IcsEventData = {
          uid: "",
          summary: current.summary || "Untitled event",
          description: current.description || "",
          location: current.location || "",
          url: current.url || "",
          dtstart: current.dtstart,
          dtstartTzid: current.dtstartTzid || "",
          dtend: current.dtend || "",
          dtendTzid: current.dtendTzid || "",
          rrule: current.rrule || "",
        };
        data.uid = current.uid || synthesizeUid(data);
        rawEvents.push(data);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const { name, params, value } = parseProperty(line);
    switch (name) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = decodeIcsText(value);
        break;
      case "DESCRIPTION":
        current.description = decodeIcsText(value);
        break;
      case "LOCATION":
        current.location = decodeIcsText(value);
        break;
      case "URL":
        current.url = decodeIcsText(value);
        break;
      case "DTSTART":
        current.dtstart = value;
        current.dtstartTzid = params.TZID || "";
        break;
      case "DTEND":
        current.dtend = value;
        current.dtendTzid = params.TZID || "";
        break;
      case "RRULE":
        current.rrule = value;
        break;
      default:
        break;
    }
  }

  return rawEvents.map((event) => normalizeIcsEvent(event, sourceId, seenAt, existingByUid));
}

/**
 * Some feeds omit UID. Falling back to a random id made the event look brand
 * new on every sync: its id churned, so remembered note paths were dropped and
 * an event the user had hidden came straight back. Derive the id from the
 * event's own content so it stays put across syncs.
 */
function synthesizeUid(event: IcsEventData): string {
  const seed = `${event.dtstart}|${event.dtend}|${event.summary}|${event.location}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return `memento-synthetic-${(hash >>> 0).toString(16)}`;
}

function normalizeIcsEvent(
  event: IcsEventData,
  sourceId: string,
  seenAt: string,
  existingByUid: Map<string, ExternalCalendarEvent>,
): ExternalCalendarEvent {
  const start = parseIcsDate(event.dtstart, event.dtstartTzid);
  const end = event.dtend ? parseIcsDate(event.dtend, event.dtendTzid) : null;
  const recurrence = parseRrule(event.rrule);
  const existing = existingByUid.get(event.uid);

  return {
    id: existing?.id || generateId(),
    sourceId,
    externalUid: event.uid,
    title: event.summary,
    context: event.description,
    location: event.location,
    url: event.url,
    date: start.date,
    time: start.time,
    endDate: end?.date,
    endTime: end?.time,
    allDay: start.allDay,
    recurrence: recurrence.recurrence,
    recurrenceInterval: recurrence.recurrenceInterval,
    recurrenceEndDate: recurrence.recurrenceEndDate,
    recurrenceCount: recurrence.recurrenceCount,
    notePaths: existing?.notePaths || {},
    lastSeenAt: seenAt,
  };
}

function unfoldIcsLines(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];

  for (const rawLine of rawLines) {
    if (/^[ \t]/.test(rawLine) && lines.length > 0) {
      lines[lines.length - 1] += rawLine.slice(1);
    } else {
      lines.push(rawLine.trimEnd());
    }
  }

  return lines;
}

function parseProperty(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return { name: line, params: {}, value: "" };

  const segments = line.slice(0, colonIdx).split(";");
  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    params[segment.slice(0, eq).toUpperCase()] = segment
      .slice(eq + 1)
      .replace(/^"|"$/g, "");
  }

  return {
    name: segments[0].toUpperCase(),
    params,
    value: line.slice(colonIdx + 1),
  };
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(
  value: string,
  tzid = "",
): { date: string; time: string; allDay: boolean } {
  const clean = value.trim();
  if (/^\d{8}$/.test(clean)) {
    return {
      date: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
      time: "",
      allDay: true,
    };
  }

  const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!match) {
    return { date: dateToStr(new Date()), time: "", allDay: true };
  }

  if (clean.endsWith("Z")) {
    return localParts(
      new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`),
    );
  }

  if (tzid) {
    const instant = zonedWallTimeToInstant(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      tzid,
    );
    if (instant) return localParts(instant);
  }

  // No TZID, or one this platform cannot resolve: treat the wall time as local,
  // which is also what RFC 5545 floating times mean.
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: `${match[4]}:${match[5]}`,
    allDay: false,
  };
}

function localParts(instant: Date): {
  date: string;
  time: string;
  allDay: boolean;
} {
  return {
    date: dateToStr(instant),
    time: `${instant.getHours().toString().padStart(2, "0")}:${instant
      .getMinutes()
      .toString()
      .padStart(2, "0")}`,
    allDay: false,
  };
}

/**
 * Offset of a named zone from UTC at a given instant, in milliseconds.
 * Returns null for anything Intl cannot resolve — Outlook feeds ship Windows
 * zone names such as "W. Europe Standard Time", which are not IANA ids.
 */
function timeZoneOffsetMs(instant: Date, timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(instant)) {
      parts[part.type] = part.value;
    }

    const hour = parts.hour === "24" ? 0 : Number(parts.hour);
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      hour,
      Number(parts.minute),
      Number(parts.second),
    );

    return asUtc - instant.getTime();
  } catch {
    return null;
  }
}

/**
 * Resolve a wall-clock time in a named zone to the instant it denotes.
 * The offset is measured twice because the first guess can land on the wrong
 * side of a DST transition.
 */
function zonedWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  const firstOffset = timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  if (firstOffset === null) return null;

  let instant = new Date(wallAsUtc - firstOffset);
  const secondOffset = timeZoneOffsetMs(instant, timeZone);
  if (secondOffset !== null && secondOffset !== firstOffset) {
    instant = new Date(wallAsUtc - secondOffset);
  }

  return instant;
}

function parseRrule(rrule: string): {
  recurrence: RecurrenceType;
  recurrenceInterval?: number;
  recurrenceEndDate?: string;
  recurrenceCount?: number;
} {
  if (!rrule) return { recurrence: "none" };

  const parts = Object.fromEntries(
    rrule.split(";").map((part) => {
      const [key, value] = part.split("=");
      return [key?.toUpperCase() || "", value || ""];
    }),
  );
  const freq = parts.FREQ?.toUpperCase();
  const recurrence = frequencyToRecurrence(freq);
  const interval = parseInt(parts.INTERVAL || "1", 10);
  const count = parseInt(parts.COUNT || "", 10);

  return {
    recurrence,
    recurrenceInterval: Number.isNaN(interval) ? 1 : Math.max(1, interval),
    recurrenceEndDate: parts.UNTIL ? parseIcsDate(parts.UNTIL).date : undefined,
    recurrenceCount: Number.isNaN(count) ? undefined : count,
  };
}

function frequencyToRecurrence(freq: string | undefined): RecurrenceType {
  switch (freq) {
    case "DAILY":
      return "daily";
    case "WEEKLY":
      return "weekly";
    case "MONTHLY":
      return "monthly";
    case "YEARLY":
      return "yearly";
    default:
      return "none";
  }
}
