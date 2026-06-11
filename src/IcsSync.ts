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
  dtend: string;
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
        rawEvents.push({
          uid: current.uid || generateId(),
          summary: current.summary || "Untitled event",
          description: current.description || "",
          location: current.location || "",
          url: current.url || "",
          dtstart: current.dtstart,
          dtend: current.dtend || "",
          rrule: current.rrule || "",
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const { name, value } = parseProperty(line);
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
        break;
      case "DTEND":
        current.dtend = value;
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

function normalizeIcsEvent(
  event: IcsEventData,
  sourceId: string,
  seenAt: string,
  existingByUid: Map<string, ExternalCalendarEvent>,
): ExternalCalendarEvent {
  const start = parseIcsDate(event.dtstart);
  const end = event.dtend ? parseIcsDate(event.dtend) : null;
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

function parseProperty(line: string): { name: string; value: string } {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return { name: line, value: "" };
  const rawName = line.slice(0, colonIdx);
  const name = rawName.split(";")[0].toUpperCase();
  return { name, value: line.slice(colonIdx + 1) };
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(value: string): { date: string; time: string; allDay: boolean } {
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
    const date = new Date(
      `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`,
    );
    return {
      date: dateToStr(date),
      time: `${date.getHours().toString().padStart(2, "0")}:${date
        .getMinutes()
        .toString()
        .padStart(2, "0")}`,
      allDay: false,
    };
  }

  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: `${match[4]}:${match[5]}`,
    allDay: false,
  };
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
