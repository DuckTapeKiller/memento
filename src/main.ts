import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMELINE_FILTERS,
  EventStatus,
  ExternalCalendarEvent,
  ExternalCalendarSource,
  MementoEvent,
  MementoSettings,
  VIEW_TYPE_TIMELINE,
  generateId,
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

    this.addRibbonIcon("calendar-clock", "Memento — Event Timeline", () => {
      void this.activateTimelineView();
    });

    this.app.workspace.onLayoutReady(() => {
      this.decorator.start();
      void this.activateTimelineView();
      void this.syncDueExternalCalendars();
    });

    this.registerInterval(
      window.setInterval(() => {
        this.refreshTimeline();
        this.decorator.refresh();
        void this.syncDueExternalCalendars();
      }, 60 * 1000),
    );
  }

  onunload(): void {
    if (this.decorator) {
      this.decorator.destroy();
    }

    this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE).forEach((leaf) => {
      leaf.detach();
    });
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
    const isEs = this.settings.frontmatterLanguage === "es";
    const titleKey = isEs ? "Título" : "Title";
    const dateKey = isEs ? "Fecha" : "Date";
    const contextKey = isEs ? "Contexto" : "Context";
    const sourceKey = isEs ? "Fuente" : "Source";
    const locationKey = isEs ? "Ubicación" : "Location";

    const dateTimeStr = event.time ? `${occurrenceDate} ${event.time}` : occurrenceDate;
    const source = "sourceId" in event ? "External calendar" : "Memento";
    const location = "location" in event ? event.location || "" : "";

    let content = "---\n";
    content += `${titleKey}: "${escapeYaml(event.title)}"\n`;
    content += `${dateKey}: ${dateTimeStr}\n`;
    content += `${contextKey}: "${escapeYaml(event.context || "")}"\n`;
    content += `${sourceKey}: "${source}"\n`;
    if (location) {
      content += `${locationKey}: "${escapeYaml(location)}"\n`;
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
    const dateTimeStr = event.time ? `${occurrenceDate} ${event.time}` : occurrenceDate;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.Title = event.title;
      frontmatter.Date = dateTimeStr;
      frontmatter.Context = event.context || "";
      frontmatter.Source = "sourceId" in event ? "External calendar" : "Memento";
      if ("location" in event && event.location) {
        frontmatter.Location = event.location;
      }
    });
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
        version: "1.0.5",
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

    if (leaf) {
      void workspace.revealLeaf(leaf);
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

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
