import {
  App,
  ButtonComponent,
  ExtraButtonComponent,
  ItemView,
  Menu,
  Modal,
  SearchComponent,
  Setting,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type MementoPlugin from "./main";
import {
  DEFAULT_TIMELINE_FILTERS,
  EventStatus,
  ExternalCalendarEvent,
  MementoEvent,
  TimelineEntry,
  VIEW_TYPE_TIMELINE,
  daysFromToday,
  formatDateDisplay,
  formatDayHeading,
  formatRelativeDay,
  formatTimeDisplay,
  getRecurrenceLabel,
  getTimelineEntries,
  getTodayStr,
} from "./types";
import { EventModal } from "./EventModal";

/** How many event cards to build at once. The timeline expands recurring
 * events per occurrence, so an unbounded list can reach hundreds of thousands
 * of cards and lock up the renderer. */
const TIMELINE_RENDER_LIMIT = 200;

/** Shown in the time column of events that have no time. */
const ALL_DAY_LABEL = "All day";

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private message: string,
    private confirmText: string,
    private onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    this.modalEl.addClass("memento-confirm-modal");
    this.contentEl.createEl("p", { text: this.message });

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container memento-modal-buttons",
    });
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => {
      this.close();
    });
    new ButtonComponent(buttons)
      .setButtonText(this.confirmText)
      .setDestructive()
      .setCta()
      .onClick(() => {
        this.close();
        this.onConfirm();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

interface EntryActions {
  edit: () => void;
  openNote: () => void;
  duplicate: () => void;
  setStatus: (status: EventStatus) => void;
  setPriority: (highPriority: boolean) => void;
  deleteEvent: () => void;
  importExternal: () => void;
  hideExternal: () => void;
  copyDetails: () => void;
}

class EventActionModal extends Modal {
  constructor(
    app: App,
    private entry: TimelineEntry,
    private noteExists: boolean,
    private showSource: boolean,
    private actions: EntryActions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    const event = this.entry.event;
    const status = getStatus(event);
    modalEl.addClass("memento-action-modal");
    this.setTitle(event.title);

    let when = formatDateDisplay(this.entry.occurrenceDate);
    if (this.entry.occurrenceTime) {
      when += ` · ${formatTimeDisplay(this.entry.occurrenceTime)}`;
      if (event.endTime && (!event.endDate || event.endDate === event.date)) {
        when += ` – ${formatTimeDisplay(event.endTime)}`;
      }
    }
    contentEl.createDiv({ cls: "memento-action-when", text: when });

    const meta = buildMeta(this.entry, this.showSource, status);
    if (isHighPriority(event)) {
      meta.unshift({ icon: "flag", text: "High priority" });
      modalEl.addClass("is-high-priority");
    }
    if (meta.length > 0) renderMeta(contentEl, meta, "memento-action-meta");

    if (event.context) {
      contentEl.createEl("p", {
        cls: "memento-action-context",
        text: event.context,
      });
    }

    const buttons = contentEl.createDiv({
      cls: "modal-button-container memento-modal-buttons",
    });

    const more = new ButtonComponent(buttons)
      .setIcon("ellipsis")
      .setTooltip("More actions")
      .onClick(() => {
        this.openMoreMenu(more.buttonEl);
      });
    more.buttonEl.addClass("memento-more-button");

    if (this.entry.editable) {
      new ButtonComponent(buttons).setButtonText("Edit").onClick(() => {
        this.close();
        this.actions.edit();
      });
    } else {
      new ButtonComponent(buttons).setButtonText("Import").onClick(() => {
        this.close();
        this.actions.importExternal();
      });
    }

    new ButtonComponent(buttons)
      .setButtonText(this.noteExists ? "Open note" : "Create note")
      .setCta()
      .onClick(() => {
        this.close();
        this.actions.openNote();
      });

    this.scope.register([], "e", () => {
      if (!this.entry.editable) return false;
      this.close();
      this.actions.edit();
      return false;
    });
    this.scope.register([], "n", () => {
      this.close();
      this.actions.openNote();
      return false;
    });
    this.scope.register([], "d", () => {
      if (!this.entry.editable) return false;
      this.close();
      this.actions.duplicate();
      return false;
    });
    this.scope.register([], "a", () => {
      if (!this.entry.editable) return false;
      this.close();
      this.actions.setStatus("archived");
      return false;
    });
  }

  private openMoreMenu(anchor: HTMLElement): void {
    const status = getStatus(this.entry.event);
    const menu = new Menu();
    const add = (title: string, icon: string, run: () => void) => {
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => {
            this.close();
            run();
          }),
      );
    };

    if (this.entry.editable) {
      if (isHighPriority(this.entry.event)) {
        add("Remove high priority", "flag-off", () =>
          this.actions.setPriority(false),
        );
      } else {
        add("Mark high priority", "flag", () =>
          this.actions.setPriority(true),
        );
      }
      add("Duplicate", "copy", this.actions.duplicate);
      if (status === "completed") {
        add("Mark as not done", "rotate-ccw", () =>
          this.actions.setStatus("active"),
        );
      } else {
        add("Mark complete", "check", () =>
          this.actions.setStatus("completed"),
        );
      }
      if (status === "archived") {
        add("Restore", "archive-restore", () =>
          this.actions.setStatus("active"),
        );
      } else {
        add("Archive", "archive", () => this.actions.setStatus("archived"));
      }
    }

    menu.addItem((item) =>
      item
        .setTitle("Copy details")
        .setIcon("clipboard")
        .onClick(() => {
          this.actions.copyDetails();
        }),
    );

    menu.addSeparator();
    if (this.entry.editable) {
      menu.addItem((item) =>
        item
          .setTitle("Delete")
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            this.close();
            this.actions.deleteEvent();
          }),
      );
    } else {
      add("Hide from timeline", "eye-off", this.actions.hideExternal);
    }

    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, anchor.doc);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TimelineView extends ItemView {
  plugin: MementoPlugin;
  private filtersExpanded = false;
  private lastRenderSignature: string | null = null;
  private renderLimit = TIMELINE_RENDER_LIMIT;
  /** Set when the filters or search change: a new result list starts at its top. */
  private scrollToTop = false;

  private search: SearchComponent | null = null;
  private filterToggleEl: HTMLElement | null = null;
  private filtersEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MementoPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TIMELINE;
  }

  getDisplayText(): string {
    return "Event timeline";
  }

  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen(): Promise<void> {
    this.buildShell();
    this.render(true);
  }

  async onClose(): Promise<void> {
    this.lastRenderSignature = null;
    this.search = null;
    this.filterToggleEl = null;
    this.filtersEl = null;
    this.listEl = null;
    this.contentEl.empty();
  }

  /**
   * The toolbar is built once and kept, so the search box holds its focus and
   * cursor while the list below it is redrawn on every keystroke.
   */
  private buildShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("memento-timeline-container");

    const toolbar = contentEl.createDiv({ cls: "memento-toolbar" });
    const filters = this.plugin.settings.timelineFilters;

    this.search = new SearchComponent(toolbar)
      .setPlaceholder("Search events")
      .setValue(filters.search)
      .onChange((value) => {
        this.plugin.settings.timelineFilters.search = value;
        this.resetRenderLimit();
        // Redraw now for responsiveness, but let the disk write coalesce.
        this.render();
        this.plugin.saveSettingsDebounced();
      });
    this.search.inputEl.parentElement?.addClass("memento-search");

    const filterToggle = new ExtraButtonComponent(toolbar)
      .setIcon("sliders-horizontal")
      .setTooltip("Filters")
      .onClick(() => {
        this.filtersExpanded = !this.filtersExpanded;
        this.syncFilterState();
      });
    this.filterToggleEl = filterToggle.extraSettingsEl;
    this.filterToggleEl.addClass("memento-toolbar-button");

    new ExtraButtonComponent(toolbar)
      .setIcon("plus")
      .setTooltip("New event")
      .onClick(() => {
        this.plugin.openCreateEventModal();
      })
      .extraSettingsEl.addClass("memento-toolbar-button");

    this.filtersEl = contentEl.createDiv({ cls: "memento-filters" });
    this.listEl = contentEl.createDiv({ cls: "memento-timeline-wrapper" });
  }

  render(force = false): void {
    if (!this.listEl || !this.filtersEl) this.buildShell();
    const settings = this.plugin.settings;

    const { entries, hasMore } = getTimelineEntries(
      settings.events,
      settings.timelineViewMode,
      settings.externalEventsCache,
      settings.timelineFilters,
      settings.externalCalendarSources,
      settings.hiddenExternalEventIds,
      this.renderLimit,
    );

    // The plugin re-renders every 60s to keep the relative days fresh.
    // Rebuilding identical DOM resets the scroll position, so skip the work
    // when nothing has changed.
    const signature = this.buildRenderSignature(entries, hasMore);
    if (!force && signature === this.lastRenderSignature) return;
    this.lastRenderSignature = signature;

    // Follow a search changed from elsewhere, but never rewrite the box while
    // it already holds the same text: that would move the cursor.
    if (this.search && this.search.getValue() !== settings.timelineFilters.search) {
      this.search.setValue(settings.timelineFilters.search);
    }

    this.renderFilters();
    this.syncFilterState();
    this.renderList(entries, hasMore);
    if (this.scrollToTop && this.listEl) {
      this.listEl.scrollTop = 0;
      this.scrollToTop = false;
    }
  }

  /** Filter changes make the old "show more" depth meaningless, and the
   * old scroll position with it. */
  private resetRenderLimit(): void {
    this.renderLimit = TIMELINE_RENDER_LIMIT;
    this.scrollToTop = true;
  }

  private buildRenderSignature(
    entries: TimelineEntry[],
    hasMore: boolean,
  ): string {
    return JSON.stringify({
      today: getTodayStr(),
      viewMode: this.plugin.settings.timelineViewMode,
      filters: this.plugin.settings.timelineFilters,
      hasMore,
      limit: this.renderLimit,
      sources: this.plugin.settings.externalCalendarSources.map(
        (source) => `${source.id}|${source.name}|${source.enabled}`,
      ),
      entries: entries.map((entry) => {
        const event = entry.event;
        return [
          entry.id,
          entry.occurrenceTime,
          entry.sourceName,
          event.title,
          event.context,
          event.endTime ?? "",
          getRecurrenceLabel(event),
          getStatus(event),
          isHighPriority(event) ? "high" : "",
          isExternalEvent(event) ? (event.location ?? "") : "",
        ].join("|");
      }),
    });
  }

  private hasActiveFilters(): boolean {
    const filters = this.plugin.settings.timelineFilters;
    return (
      filters.source !== DEFAULT_TIMELINE_FILTERS.source ||
      filters.sourceId !== DEFAULT_TIMELINE_FILTERS.sourceId ||
      filters.dateRange !== DEFAULT_TIMELINE_FILTERS.dateRange ||
      filters.includeCompleted !== DEFAULT_TIMELINE_FILTERS.includeCompleted ||
      filters.includeArchived !== DEFAULT_TIMELINE_FILTERS.includeArchived
    );
  }

  /** The calendar name is only worth showing when there is more than one. */
  private shouldShowSource(): boolean {
    return this.plugin.settings.externalCalendarSources.some(
      (source) => source.enabled,
    );
  }

  private syncFilterState(): void {
    this.filtersEl?.toggleClass("is-visible", this.filtersExpanded);
    const toggle = this.filterToggleEl;
    if (!toggle) return;
    toggle.toggleClass("is-active", this.filtersExpanded);
    // A dot on the button says the list is filtered while the panel is shut.
    toggle.toggleClass("has-active-filters", this.hasActiveFilters());
    toggle.setAttribute("aria-expanded", String(this.filtersExpanded));
  }

  private renderFilters(): void {
    const container = this.filtersEl;
    if (!container) return;
    container.empty();
    const filters = this.plugin.settings.timelineFilters;

    const changed = () => {
      this.resetRenderLimit();
      void this.plugin.saveSettings();
    };

    this.addThemedDropdown(
      new Setting(container).setName("Source"),
      [
        { value: "all", label: "All sources" },
        { value: "memento", label: "Memento only" },
        { value: "external", label: "External only" },
      ],
      filters.source,
      (value) => {
        filters.source = value as typeof filters.source;
        filters.sourceId = "";
        changed();
      },
    );

    this.addThemedDropdown(
      new Setting(container).setName("Calendar"),
      [
        { value: "", label: "Any calendar" },
        { value: "memento", label: "Memento" },
        ...this.plugin.settings.externalCalendarSources.map((source) => ({
          value: source.id,
          label: source.name,
        })),
      ],
      filters.sourceId,
      (value) => {
        filters.sourceId = value;
        changed();
      },
    );

    this.addThemedDropdown(
      new Setting(container).setName("Dates"),
      [
        { value: "upcoming", label: "Upcoming" },
        { value: "week", label: "Next 7 days" },
        { value: "month", label: "Next month" },
        { value: "all", label: "All" },
      ],
      filters.dateRange,
      (value) => {
        filters.dateRange = value as typeof filters.dateRange;
        changed();
      },
    );

    new Setting(container).setName("Show completed").addToggle((toggle) =>
      toggle.setValue(filters.includeCompleted).onChange((value) => {
        filters.includeCompleted = value;
        changed();
      }),
    );

    new Setting(container).setName("Show archived").addToggle((toggle) =>
      toggle.setValue(filters.includeArchived).onChange((value) => {
        filters.includeArchived = value;
        changed();
      }),
    );

    if (this.hasActiveFilters()) {
      const reset = container.createEl("button", {
        cls: "memento-filters-reset",
        text: "Reset filters",
        attr: { type: "button" },
      });
      reset.addEventListener("click", () => {
        this.plugin.settings.timelineFilters = {
          ...DEFAULT_TIMELINE_FILTERS,
          search: filters.search,
        };
        changed();
      });
    }
  }

  /**
   * Render a fully theme-styled dropdown (button + Obsidian Menu) instead of a
   * native <select>, whose open option list is rendered by the OS and cannot be
   * themed with CSS. The Menu honours the user's Obsidian theme.
   */
  private addThemedDropdown(
    setting: Setting,
    options: { value: string; label: string }[],
    current: string,
    onChange: (value: string) => void,
  ): void {
    const selected =
      options.find((option) => option.value === current) ?? options[0];

    const button = setting.controlEl.createEl("button", {
      cls: "memento-dropdown",
      attr: { type: "button" },
    });
    button.createSpan({
      cls: "memento-dropdown-label",
      text: selected?.label ?? "",
    });
    const arrow = button.createSpan({ cls: "memento-dropdown-arrow" });
    setIcon(arrow, "chevron-down");

    button.addEventListener("click", () => {
      const menu = new Menu();
      for (const option of options) {
        menu.addItem((item) =>
          item
            .setTitle(option.label)
            .setChecked(option.value === current)
            .onClick(() => {
              if (option.value !== current) onChange(option.value);
            }),
        );
      }
      const rect = button.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, button.doc);
    });
  }

  private renderList(entries: TimelineEntry[], hasMore: boolean): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();

    if (entries.length === 0) {
      this.renderEmptyState(list);
      return;
    }

    const showSource = this.shouldShowSource();
    let currentDate = "";
    let dayList: HTMLElement = list;

    for (const entry of entries) {
      if (entry.occurrenceDate !== currentDate) {
        currentDate = entry.occurrenceDate;
        dayList = this.renderDay(list, currentDate);
      }
      this.renderEntry(dayList, entry, showSource);
    }

    if (hasMore) {
      const more = list.createDiv({ cls: "memento-timeline-more" });
      more.createDiv({
        text: `Showing the first ${entries.length} events`,
        cls: "memento-timeline-more-count",
      });
      new ButtonComponent(more)
        .setButtonText(`Show ${TIMELINE_RENDER_LIMIT} more`)
        .onClick(() => {
          this.renderLimit += TIMELINE_RENDER_LIMIT;
          this.render(true);
        });
    }
  }

  /** A day heading and the list its events go into. */
  private renderDay(container: HTMLElement, date: string): HTMLElement {
    const days = daysFromToday(date);
    const section = container.createEl("section", { cls: "memento-day" });
    if (days === 0) section.addClass("is-today");
    if (days < 0) section.addClass("is-past");

    const header = section.createEl("h3", { cls: "memento-day-header" });
    header.createSpan({
      cls: "memento-day-date",
      text: formatDayHeading(date),
    });
    header.createSpan({
      cls: "memento-day-relative",
      text: formatRelativeDay(date),
    });

    return section.createEl("ul", { cls: "memento-day-events" });
  }

  private renderEntry(
    ul: HTMLElement,
    entry: TimelineEntry,
    showSource: boolean,
  ): void {
    const event = entry.event;
    const status = getStatus(event);

    const li = ul.createEl("li", {
      cls: ["memento-event", `memento-event-${entry.sourceType}`],
      attr: { tabindex: "0" },
    });
    if (status !== "active") li.addClass(`is-${status}`);
    if (isHighPriority(event)) li.addClass("is-high-priority");

    li.addEventListener("click", () => {
      void this.openEntryActions(entry);
    });
    li.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      void this.openEntryActions(entry);
    });

    // Time column: a dot in the calendar's colour, then the time.
    const timeEl = li.createDiv({ cls: "memento-event-time" });
    timeEl.createSpan({ cls: "memento-event-dot" });
    const times = timeEl.createDiv({ cls: "memento-event-times" });
    if (entry.occurrenceTime) {
      times.createDiv({ text: formatTimeDisplay(entry.occurrenceTime) });
      if (event.endTime && (!event.endDate || event.endDate === event.date)) {
        times.createDiv({
          cls: "memento-event-end",
          text: formatTimeDisplay(event.endTime),
        });
      }
    } else {
      times.createDiv({ cls: "memento-event-all-day", text: ALL_DAY_LABEL });
    }

    const body = li.createDiv({ cls: "memento-event-body" });
    body.createDiv({ cls: "memento-event-title", text: event.title });
    if (event.context) {
      body.createDiv({ cls: "memento-event-context", text: event.context });
    }
    const meta = buildMeta(entry, showSource, status);
    if (meta.length > 0) renderMeta(body, meta, "memento-event-meta");

    // The action has a column of its own, so text can never run under it.
    const action = li.createEl("button", {
      cls: "memento-event-action clickable-icon",
      attr: {
        type: "button",
        "aria-label": entry.editable ? "Delete event" : "Hide event",
      },
    });
    setIcon(action, entry.editable ? "trash-2" : "eye-off");
    action.addEventListener("keydown", (evt) => {
      evt.stopPropagation();
    });
    action.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (entry.editable) {
        this.confirmDelete(entry);
      } else {
        this.plugin.hideExternalEvent(entry.event.id);
      }
    });
  }

  private confirmDelete(entry: TimelineEntry): void {
    new ConfirmModal(
      this.plugin.app,
      "Delete event",
      `“${entry.event.title}” will be deleted, with every repeat of it. This cannot be undone.`,
      "Delete",
      () => {
        this.plugin.deleteEvent(entry.event.id);
      },
    ).open();
  }

  private async openEntryActions(entry: TimelineEntry): Promise<void> {
    const filePath = this.plugin.getEventNotePath(
      entry.event,
      entry.occurrenceDate,
    );
    const fileExists = await this.plugin.app.vault.adapter.exists(filePath);

    new EventActionModal(
      this.plugin.app,
      entry,
      fileExists,
      this.shouldShowSource(),
      {
        edit: () => {
          if (isMementoEvent(entry.event)) this.openEditEventModal(entry.event);
        },
        openNote: () => {
          void this.plugin.createNoteForEvent(entry.event, entry.occurrenceDate);
        },
        duplicate: () => {
          if (isMementoEvent(entry.event))
            this.plugin.duplicateEvent(entry.event);
        },
        setStatus: (status) => {
          if (isMementoEvent(entry.event))
            this.plugin.setEventStatus(entry.event.id, status);
        },
        setPriority: (highPriority) => {
          if (isMementoEvent(entry.event))
            this.plugin.setEventPriority(entry.event.id, highPriority);
        },
        deleteEvent: () => {
          this.confirmDelete(entry);
        },
        importExternal: () => {
          if (isExternalEvent(entry.event))
            this.plugin.importExternalEvent(entry.event, entry.occurrenceDate);
        },
        hideExternal: () => {
          this.plugin.hideExternalEvent(entry.event.id);
        },
        copyDetails: () => {
          const lines = [
            entry.event.title,
            formatDateDisplay(entry.occurrenceDate),
            entry.occurrenceTime ? formatTimeDisplay(entry.occurrenceTime) : "",
            entry.event.context,
          ].filter(Boolean);
          void navigator.clipboard.writeText(lines.join("\n"));
        },
      },
    ).open();
  }

  private renderEmptyState(container: HTMLElement): void {
    const filtered =
      this.hasActiveFilters() ||
      this.plugin.settings.timelineFilters.search.trim() !== "";
    const empty = container.createDiv({ cls: "memento-empty-state" });
    setIcon(empty.createDiv({ cls: "memento-empty-icon" }), "calendar");

    empty.createDiv({
      cls: "memento-empty-title",
      text: filtered ? "No events match" : "No upcoming events",
    });
    empty.createDiv({
      cls: "memento-empty-desc",
      text: filtered
        ? "Try another search, or change the filters."
        : "Right-click a day in the calendar to add one, or add an ICS calendar in the settings.",
    });

    if (!filtered) {
      new ButtonComponent(empty).setButtonText("New event").onClick(() => {
        this.plugin.openCreateEventModal();
      });
    }
  }

  private openEditEventModal(event: MementoEvent): void {
    new EventModal(
      this.plugin.app,
      (updatedEvent) => {
        this.plugin.updateEvent(updatedEvent);
      },
      event,
    ).open();
  }
}

interface MetaItem {
  icon: string;
  text: string;
}

/** The quiet line under an event: repeat, place, calendar and status. */
function buildMeta(
  entry: TimelineEntry,
  showSource: boolean,
  status: EventStatus,
): MetaItem[] {
  const event = entry.event;
  const meta: MetaItem[] = [];
  if (event.recurrence !== "none") {
    meta.push({ icon: "repeat", text: getRecurrenceLabel(event) });
  }
  if (isExternalEvent(event) && event.location) {
    meta.push({ icon: "map-pin", text: event.location });
  }
  if (showSource) {
    meta.push({ icon: "calendar", text: entry.sourceName });
  }
  if (status === "completed") meta.push({ icon: "check", text: "Completed" });
  if (status === "archived") meta.push({ icon: "archive", text: "Archived" });
  return meta;
}

function renderMeta(container: HTMLElement, meta: MetaItem[], cls: string): void {
  const metaEl = container.createDiv({ cls });
  for (const item of meta) {
    const itemEl = metaEl.createSpan({ cls: "memento-meta-item" });
    setIcon(itemEl.createSpan({ cls: "memento-meta-icon" }), item.icon);
    itemEl.createSpan({ cls: "memento-meta-text", text: item.text });
  }
}

function isHighPriority(event: MementoEvent | ExternalCalendarEvent): boolean {
  return isMementoEvent(event) && !!event.highPriority;
}

function getStatus(event: MementoEvent | ExternalCalendarEvent): EventStatus {
  return isMementoEvent(event) ? (event.status ?? "active") : "active";
}

function isExternalEvent(
  event: MementoEvent | ExternalCalendarEvent,
): event is ExternalCalendarEvent {
  return "externalUid" in event;
}

function isMementoEvent(
  event: MementoEvent | ExternalCalendarEvent,
): event is MementoEvent {
  return !isExternalEvent(event);
}
