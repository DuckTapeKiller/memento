import {
  Debouncer,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMELINE_FILTERS,
  EventStatus,
  ExternalCalendarEvent,
  ExternalCalendarSource,
  MementoEvent,
  MementoSettings,
  TimelineEntry,
  VIEW_TYPE_TIMELINE,
  formatTimeDisplay,
  generateId,
  getPendingEntries,
  getTodayStr,
  normalizeEvent,
} from "./types";
import { EventModal } from "./EventModal";
import { TimelineView } from "./TimelineView";
import { CalendarDecorator } from "./CalendarDecorator";
import { EventSettingsTab } from "./EventSettingsTab";
import { syncExternalCalendarSource } from "./IcsSync";

export default class MementoPlugin extends Plugin {
  settings!: MementoSettings;
  private decorator!: CalendarDecorator;
  private ribbonEl: HTMLElement | null = null;
  private statusBarEl: HTMLElement | null = null;
  private statusBarCountEl: HTMLElement | null = null;
  private indicatorTimeoutId: number | null = null;

  /**
   * Coalesced settings write. The timeline's search box changes settings on
   * every keystroke, and each save is a full data.json write plus a recurrence
   * expansion — far too much work to do per character.
   */
  saveSettingsDebounced: Debouncer<[], void> = debounce(
    () => {
      void this.saveSettings();
    },
    400,
    true,
  );

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_TIMELINE, (leaf: WorkspaceLeaf) => {
      return new TimelineView(leaf, this);
    });

    this.addSettingTab(new EventSettingsTab(this.app, this));
    this.decorator = new CalendarDecorator(this);

    this.addCommand({
      id: "create-event",
      name: "Create a new event",
      callback: () => {
        this.openCreateEventModal();
      },
    });

    this.addCommand({
      id: "create-event-today",
      name: "Create event for today",
      callback: () => {
        this.createEventForDate(getTodayStr());
      },
    });

    this.addCommand({
      id: "open-timeline",
      name: "Open event timeline",
      callback: () => {
        void this.activateTimelineView();
      },
    });

    this.addCommand({
      id: "refresh-external-calendars",
      name: "Refresh external calendars",
      callback: () => {
        void this.syncExternalCalendars();
      },
    });

    this.ribbonEl = this.addRibbonIcon(
      "calendar-clock",
      "Memento event timeline",
      () => {
        void this.activateTimelineView();
      },
    );
    this.ribbonEl.addClass("memento-ribbon-icon");

    this.createStatusBarItem();

    this.app.workspace.onLayoutReady(() => {
      this.decorator.start();
      if (this.settings.openTimelineOnStartup) {
        void this.activateTimelineView();
      }
      void this.syncDueExternalCalendars();
      this.updatePendingIndicators();
    });

    this.registerInterval(
      window.setInterval(() => {
        this.refreshTimeline();
        this.decorator.refresh();
        this.updatePendingIndicators();
        void this.syncDueExternalCalendars();
      }, 60 * 1000),
    );
  }

  onunload(): void {
    if (this.decorator) {
      this.decorator.destroy();
    }

    if (this.indicatorTimeoutId !== null) {
      window.clearTimeout(this.indicatorTimeoutId);
      this.indicatorTimeoutId = null;
    }

    this.saveSettingsDebounced.cancel();

    // Deliberately no leaf.detach() here: Obsidian persists the workspace
    // layout itself, and detaching on unload is what made the timeline
    // reappear on every start regardless of how the user left it.
  }

  // ─── Settings Persistence ────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const data =
      ((await this.loadData()) as Partial<MementoSettings> | null | undefined) ||
      {};

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      timelineFilters: {
        ...DEFAULT_TIMELINE_FILTERS,
        ...(data.timelineFilters || {}),
        // Never restore a search term: a query typed weeks ago silently
        // hiding events on startup is indistinguishable from a bug.
        search: "",
      },
      externalCalendarSources: data.externalCalendarSources || [],
      externalEventsCache: data.externalEventsCache || [],
      hiddenExternalEventIds: data.hiddenExternalEventIds || [],
      events: (data.events || []).map((event) => normalizeEvent(event)),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshTimeline();
    this.decorator?.refresh();
    this.updatePendingIndicators();
  }

  // ─── Event Management ────────────────────────────────────────────

  openCreateEventModal(): void {
    new EventModal(this.app, (event: MementoEvent) => {
      this.settings.events.push(this.prepareEvent(event));
      void this.saveSettings();
    }).open();
  }

  createEventForDate(dateStr: string): void {
    new EventModal(
      this.app,
      (event: MementoEvent) => {
        this.settings.events.push(this.prepareEvent(event));
        void this.saveSettings();
      },
      undefined,
      dateStr,
    ).open();
  }

  updateEvent(updatedEvent: MementoEvent): void {
    const idx = this.settings.events.findIndex((event) => event.id === updatedEvent.id);
    if (idx === -1) return;
    this.settings.events[idx] = this.prepareEvent({
      ...this.settings.events[idx],
      ...updatedEvent,
      updatedAt: new Date().toISOString(),
    });
    void this.saveSettings();
  }

  duplicateEvent(event: MementoEvent): void {
    const now = new Date().toISOString();
    this.settings.events.push(
      this.prepareEvent({
        ...event,
        id: generateId(),
        title: `${event.title} copy`,
        status: "active",
        notePaths: {},
        createdAt: now,
        updatedAt: now,
      }),
    );
    void this.saveSettings();
  }

  setEventStatus(eventId: string, status: EventStatus): void {
    const event = this.settings.events.find((item) => item.id === eventId);
    if (!event) return;
    event.status = status;
    event.updatedAt = new Date().toISOString();
    void this.saveSettings();
  }

  deleteEvent(eventId: string): void {
    this.settings.events = this.settings.events.filter((event) => event.id !== eventId);
    void this.saveSettings();
  }

  importExternalEvent(
    event: ExternalCalendarEvent,
    occurrenceDate: string = event.date,
  ): MementoEvent {
    const now = new Date().toISOString();
    const imported = this.prepareEvent({
      id: generateId(),
      date: occurrenceDate,
      time: event.time,
      endDate: event.endDate,
      endTime: event.endTime,
      title: event.title,
      context: event.context || event.location || "",
      recurrence: event.recurrence,
      recurrenceInterval: event.recurrenceInterval,
      recurrenceEndDate: event.recurrenceEndDate,
      recurrenceCount: event.recurrenceCount,
      status: "active",
      notePaths: {},
      createdAt: now,
      updatedAt: now,
    });
    this.settings.events.push(imported);
    void this.saveSettings();
    return imported;
  }

  hideExternalEvent(eventId: string): void {
    if (!this.settings.hiddenExternalEventIds.includes(eventId)) {
      this.settings.hiddenExternalEventIds.push(eventId);
      void this.saveSettings();
    }
  }

  private prepareEvent(event: MementoEvent): MementoEvent {
    const now = new Date().toISOString();
    return normalizeEvent({
      ...event,
      createdAt: event.createdAt || now,
      updatedAt: event.updatedAt || now,
    });
  }

  // ─── Notes ───────────────────────────────────────────────────────

  getEventNotePath(
    event: MementoEvent | ExternalCalendarEvent,
    occurrenceDate: string,
  ): string {
    const existingPath = event.notePaths?.[occurrenceDate];
    if (existingPath) return existingPath;

    const folderPath = this.settings.eventNoteFolder.trim();
    const safeTitle = event.title.replace(/[\\/:"*?<>|#^[\]]/g, "").trim();
    const filename = `${occurrenceDate} - ${safeTitle || "Untitled event"}.md`;
    return folderPath ? `${folderPath}/${filename}` : filename;
  }

  async createNoteForEvent(
    event: MementoEvent | ExternalCalendarEvent,
    occurrenceDate: string,
  ): Promise<void> {
    const { vault, workspace } = this.app;
    const folderPath = this.settings.eventNoteFolder.trim();

    if (folderPath !== "") {
      const folderExists = await vault.adapter.exists(folderPath);
      if (!folderExists) {
        await vault.createFolder(folderPath);
      }
    }

    const filePath = this.getEventNotePath(event, occurrenceDate);
    const abstractFile = vault.getAbstractFileByPath(filePath);
    let file: TFile | null = abstractFile instanceof TFile ? abstractFile : null;

    if (!file) {
      file = await vault.create(filePath, this.buildNoteContent(event, occurrenceDate));
      this.rememberNotePath(event, occurrenceDate, file.path);
      await this.saveSettings();
    } else {
      this.rememberNotePath(event, occurrenceDate, file.path);
      await this.syncNoteFrontmatter(file, event, occurrenceDate);
      await this.saveSettings();
    }

    const leaf = workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  private buildNoteContent(
    event: MementoEvent | ExternalCalendarEvent,
    occurrenceDate: string,
  ): string {
    const keys = FRONTMATTER_KEYS[this.settings.frontmatterLanguage];

    const dateTimeStr = event.time ? `${occurrenceDate} ${event.time}` : occurrenceDate;
    const source = "sourceId" in event ? "External calendar" : "Memento";
    const location = "location" in event ? event.location || "" : "";

    let content = "---\n";
    content += `${keys.title}: "${escapeYaml(event.title)}"\n`;
    content += `${keys.date}: ${dateTimeStr}\n`;
    content += `${keys.context}: "${escapeYaml(event.context || "")}"\n`;
    content += `${keys.source}: "${source}"\n`;
    if (location) {
      content += `${keys.location}: "${escapeYaml(location)}"\n`;
    }
    content += "---\n\n";
    content += `# ${event.title}\n`;
    if (event.context) {
      content += `\n${event.context}\n`;
    }
    return content;
  }

  private async syncNoteFrontmatter(
    file: TFile,
    event: MementoEvent | ExternalCalendarEvent,
    occurrenceDate: string,
  ): Promise<void> {
    const language = this.settings.frontmatterLanguage;
    const keys = FRONTMATTER_KEYS[language];
    const stale = FRONTMATTER_KEYS[language === "es" ? "en" : "es"];
    const dateTimeStr = event.time ? `${occurrenceDate} ${event.time}` : occurrenceDate;

    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter: Record<string, unknown>) => {
        // This used to write English keys whatever the language setting said, so
        // reopening a Spanish note left it holding both sets of properties, free
        // to drift apart. Clearing the inactive language's keys also repairs
        // notes that already picked up the duplicates.
        for (const key of Object.values(stale)) {
          delete frontmatter[key];
        }

        frontmatter[keys.title] = event.title;
        frontmatter[keys.date] = dateTimeStr;
        frontmatter[keys.context] = event.context || "";
        frontmatter[keys.source] =
          "sourceId" in event ? "External calendar" : "Memento";
        if ("location" in event && event.location) {
          frontmatter[keys.location] = event.location;
        }
      },
    );
  }

  private rememberNotePath(
    event: MementoEvent | ExternalCalendarEvent,
    occurrenceDate: string,
    notePath: string,
  ): void {
    if ("externalUid" in event) {
      const cached = this.settings.externalEventsCache.find((item) => item.id === event.id);
      if (cached) {
        cached.notePaths = { ...(cached.notePaths || {}), [occurrenceDate]: notePath };
      }
      return;
    }

    const stored = this.settings.events.find((item) => item.id === event.id);
    if (stored) {
      stored.notePaths = { ...(stored.notePaths || {}), [occurrenceDate]: notePath };
      stored.updatedAt = new Date().toISOString();
    }
  }

  // ─── External Calendar Sync ──────────────────────────────────────

  addExternalCalendarSource(source: Omit<ExternalCalendarSource, "id">): void {
    this.settings.externalCalendarSources.push({
      ...source,
      id: generateId(),
    });
    void this.saveSettings().then(() => this.syncExternalCalendars());
  }

  updateExternalCalendarSource(source: ExternalCalendarSource): void {
    const idx = this.settings.externalCalendarSources.findIndex(
      (item) => item.id === source.id,
    );
    if (idx === -1) return;
    this.settings.externalCalendarSources[idx] = source;
    void this.saveSettings();
  }

  deleteExternalCalendarSource(sourceId: string): void {
    this.settings.externalCalendarSources = this.settings.externalCalendarSources.filter(
      (source) => source.id !== sourceId,
    );
    this.settings.externalEventsCache = this.settings.externalEventsCache.filter(
      (event) => event.sourceId !== sourceId,
    );
    void this.saveSettings();
  }

  async syncDueExternalCalendars(): Promise<void> {
    const now = Date.now();
    const dueSources = this.settings.externalCalendarSources.filter((source) => {
      if (!source.enabled) return false;
      if (!source.lastFetchedAt) return true;
      const elapsedMinutes = (now - new Date(source.lastFetchedAt).getTime()) / 60000;
      return elapsedMinutes >= source.refreshIntervalMinutes;
    });

    if (dueSources.length === 0) return;
    await this.syncExternalCalendars(dueSources.map((source) => source.id));
  }

  async syncExternalCalendars(sourceIds?: string[]): Promise<void> {
    const sources = this.settings.externalCalendarSources.filter((source) => {
      if (!source.enabled) return false;
      return !sourceIds || sourceIds.includes(source.id);
    });

    for (const source of sources) {
      try {
        const result = await syncExternalCalendarSource(
          source,
          this.settings.externalEventsCache,
        );
        this.settings.externalCalendarSources = this.settings.externalCalendarSources.map(
          (item) => (item.id === source.id ? result.source : item),
        );
        this.settings.externalEventsCache = [
          ...this.settings.externalEventsCache.filter(
            (event) => event.sourceId !== source.id,
          ),
          ...result.events,
        ];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.settings.externalCalendarSources = this.settings.externalCalendarSources.map(
          (item) =>
            item.id === source.id
              ? { ...item, lastError: message, lastFetchedAt: new Date().toISOString() }
              : item,
        );
        new Notice(`Memento calendar sync failed: ${source.name}`);
      }
    }

    await this.saveSettings();
  }

  // ─── Data Import / Export ────────────────────────────────────────

  async exportEventsToJson(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `memento-export-${stamp}.json`;
    const payload = JSON.stringify(
      {
        version: this.manifest.version,
        exportedAt: new Date().toISOString(),
        events: this.settings.events,
        externalCalendarSources: this.settings.externalCalendarSources,
      },
      null,
      2,
    );
    await this.app.vault.create(filename, payload);
    new Notice(`Memento export created: ${filename}`);
  }

  importEventsFromJson(text: string): number {
    const parsed = JSON.parse(text) as { events?: MementoEvent[] };
    const incoming = parsed.events || [];
    const existingIds = new Set(this.settings.events.map((event) => event.id));
    const imported = incoming.map((event) => {
      const id = existingIds.has(event.id) ? generateId() : event.id || generateId();
      existingIds.add(id);
      return this.prepareEvent({ ...event, id });
    });
    this.settings.events.push(...imported);
    void this.saveSettings();
    return imported.length;
  }

  // ─── Pending Indicators ──────────────────────────────────────────

  /**
   * Status bar item showing the pending event count. The status bar is not
   * available on mobile, which is why the ribbon badge exists alongside it.
   */
  private createStatusBarItem(): void {
    if (Platform.isMobile) return;

    const el = this.addStatusBarItem();
    el.addClass("memento-status-bar-item", "mod-clickable");

    const iconEl = el.createSpan({ cls: "memento-status-bar-icon" });
    renderCalendarCheckIcon(iconEl);

    this.statusBarCountEl = el.createSpan({ cls: "memento-status-bar-count" });
    el.addEventListener("click", () => {
      void this.activateTimelineView();
    });

    this.statusBarEl = el;
  }

  getPendingEntries(): TimelineEntry[] {
    return getPendingEntries({
      events: this.settings.events,
      externalEvents: this.settings.externalEventsCache,
      externalSources: this.settings.externalCalendarSources,
      hiddenExternalEventIds: this.settings.hiddenExternalEventIds,
      countWindow: this.settings.pendingCountWindow,
      includeOverdue: this.settings.pendingIncludeOverdue,
    });
  }

  /**
   * Debounced: saveSettings() calls this, and the timeline's search box saves
   * on every keystroke, so a burst of saves must not each pay for a full
   * recurrence expansion.
   */
  updatePendingIndicators(): void {
    if (this.indicatorTimeoutId !== null) {
      window.clearTimeout(this.indicatorTimeoutId);
    }
    this.indicatorTimeoutId = window.setTimeout(() => {
      this.indicatorTimeoutId = null;
      this.renderPendingIndicators();
    }, 150);
  }

  private renderPendingIndicators(): void {
    const entries = this.getPendingEntries();
    const count = entries.length;
    const tooltip = this.buildPendingTooltip(entries);

    if (this.statusBarEl && this.statusBarCountEl) {
      const visible = this.settings.showStatusBarCount && count > 0;
      this.statusBarEl.toggleClass("memento-is-hidden", !visible);
      this.statusBarCountEl.setText(count.toString());
      this.statusBarEl.setAttribute("aria-label", tooltip);
    }

    if (this.ribbonEl) {
      const visible = this.settings.showRibbonBadge && count > 0;
      this.ribbonEl.toggleClass("memento-has-pending", visible);
      this.ribbonEl.dataset.mementoPending = count > 99 ? "99+" : count.toString();
      this.ribbonEl.setAttribute(
        "aria-label",
        count > 0
          ? `Memento event timeline (${count} pending)`
          : "Memento event timeline",
      );
    }
  }

  private buildPendingTooltip(entries: TimelineEntry[]): string {
    if (entries.length === 0) return "Memento: no pending events";

    const lines = entries.slice(0, 3).map((entry) => {
      const time = entry.occurrenceTime
        ? ` ${formatTimeDisplay(entry.occurrenceTime)}`
        : "";
      return `${entry.occurrenceDate}${time} — ${entry.event.title}`;
    });

    if (entries.length > 3) {
      lines.push(`+${entries.length - 3} more`);
    }

    return lines.join("\n");
  }

  // ─── Timeline View ───────────────────────────────────────────────

  async activateTimelineView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_TIMELINE,
          active: true,
        });
        leaf = rightLeaf;
      }
    }

    // Reloading the plugin (disable then enable, as a version update does) can
    // start a second activation while the first setViewState is still in
    // flight; each one sees no existing leaf and creates its own, leaving
    // stacked duplicate panels behind. Keep a single live view.
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    const keep =
      existing.find((item) => item.view instanceof TimelineView) ??
      existing[0] ??
      leaf;
    for (const duplicate of existing) {
      if (duplicate !== keep) duplicate.detach();
    }

    if (keep) {
      void workspace.revealLeaf(keep);
    }
  }

  refreshTimeline(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of leaves) {
      if (leaf.view instanceof TimelineView) {
        leaf.view.render();
      }
    }
  }
}

/**
 * Draw Lucide's current `calendar-check` explicitly.
 *
 * setIcon() would be simpler, but the glyph then depends on whichever Lucide
 * version the host app bundles — Obsidian 1.8 still ships the older artwork
 * (rect y=4, "M3 10h18"), which does not match the icon this plugin is
 * specified to show. Drawing the paths keeps it identical on every version.
 */
function renderCalendarCheckIcon(parent: HTMLElement): void {
  const svg = parent.createSvg("svg", {
    // Array form on purpose: createSvg feeds `cls` straight to classList.add(),
    // which rejects a space-separated string despite what the typings claim.
    cls: ["svg-icon", "memento-calendar-check"],
    attr: {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
  });
  svg.createSvg("path", { attr: { d: "M8 2v3" } });
  svg.createSvg("path", { attr: { d: "M16 2v3" } });
  svg.createSvg("rect", {
    attr: { x: "3", y: "3", width: "18", height: "18", rx: "2" },
  });
  svg.createSvg("path", { attr: { d: "M3 9h18" } });
  svg.createSvg("path", { attr: { d: "m9 15 2 2 4-4" } });
}

/**
 * Frontmatter property names per language. Both the note template and the
 * refresh-on-reopen path read from here so they can never disagree.
 */
const FRONTMATTER_KEYS: Record<
  "en" | "es",
  { title: string; date: string; context: string; source: string; location: string }
> = {
  en: {
    title: "Title",
    date: "Date",
    context: "Context",
    source: "Source",
    location: "Location",
  },
  es: {
    title: "Título",
    date: "Fecha",
    context: "Contexto",
    source: "Fuente",
    location: "Ubicación",
  },
};

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
