import {
  App,
  ItemView,
  Menu,
  Modal,
  Setting,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type MementoPlugin from "./main";
import {
  ExternalCalendarEvent,
  MementoEvent,
  TimelineEntry,
  VIEW_TYPE_TIMELINE,
  formatDateDisplay,
  formatTimeDisplay,
  getRecurrenceLabel,
  getTimelineEntries,
} from "./types";
import { EventModal } from "./EventModal";

class ConfirmModal extends Modal {
  constructor(
    app: App,
    public title: string,
    public message: string,
    public onConfirm: () => void,
    public confirmText: string = "Confirm",
    public isWarning: boolean = false,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      )
      .addButton((btn) => {
        btn.setButtonText(this.confirmText).onClick(() => {
          this.close();
          this.onConfirm();
        });
        if (this.isWarning) {
          btn.setDestructive();
        } else {
          btn.setCta();
        }
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class EventActionModal extends Modal {
  constructor(
    app: App,
    private entry: TimelineEntry,
    private noteExists: boolean,
    private actions: {
      edit: () => void;
      openNote: () => void;
      duplicate: () => void;
      complete: () => void;
      archive: () => void;
      deleteEvent: () => void;
      importExternal: () => void;
      hideExternal: () => void;
      copyDetails: () => void;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const event = this.entry.event;
    contentEl.addClass("memento-action-modal");
    contentEl.createEl("h2", { text: event.title });
    contentEl.createEl("p", {
      text: `${formatDateDisplay(this.entry.occurrenceDate)}${
        this.entry.occurrenceTime
          ? ` at ${formatTimeDisplay(this.entry.occurrenceTime)}`
          : ""
      }`,
      cls: "setting-item-description",
    });
    contentEl.createEl("p", {
      text: this.entry.sourceName,
      cls: "memento-action-source",
    });

    if (event.context) {
      contentEl.createEl("p", { text: event.context });
    }
    if (isExternalEvent(event) && event.location) {
      contentEl.createEl("p", {
        text: event.location,
        cls: "setting-item-description",
      });
    }

    const setting = new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Cancel").onClick(() => {
        this.close();
      }),
    );

    if (this.entry.editable) {
      setting
        .addButton((btn) =>
          btn.setButtonText("Edit Event").onClick(() => {
            this.close();
            this.actions.edit();
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Duplicate").onClick(() => {
            this.close();
            this.actions.duplicate();
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Complete").onClick(() => {
            this.close();
            this.actions.complete();
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Archive").onClick(() => {
            this.close();
            this.actions.archive();
          }),
        );
    } else {
      setting
        .addButton((btn) =>
          btn.setButtonText("Import").onClick(() => {
            this.close();
            this.actions.importExternal();
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Hide").onClick(() => {
            this.close();
            this.actions.hideExternal();
          }),
        );
    }

    setting
      .addButton((btn) =>
        btn.setButtonText("Copy").onClick(() => {
          this.actions.copyDetails();
        }),
      )
      .addButton((btn) => {
        btn
          .setButtonText(this.noteExists ? "Open Note" : "Create Note")
          .setCta()
          .onClick(() => {
            this.close();
            this.actions.openNote();
          });
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
      this.actions.archive();
      return false;
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TimelineView extends ItemView {
  plugin: MementoPlugin;
  private shouldRestoreSearchFocus = false;
  private searchCursorPosition: number | null = null;
  private filtersExpanded = false;

  constructor(leaf: WorkspaceLeaf, plugin: MementoPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TIMELINE;
  }

  getDisplayText(): string {
    return "Event Timeline";
  }

  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("memento-timeline-container");

    this.renderFilters(contentEl);

    const entries = getTimelineEntries(
      this.plugin.settings.events,
      this.plugin.settings.timelineViewMode,
      this.plugin.settings.externalEventsCache,
      this.plugin.settings.timelineFilters,
      this.plugin.settings.externalCalendarSources,
      this.plugin.settings.hiddenExternalEventIds,
    );

    if (entries.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    const timelineWrapper = contentEl.createDiv({
      cls: "memento-timeline-wrapper",
    });
    const ul = timelineWrapper.createEl("ul", { cls: "memento-timeline" });

    for (const entry of entries) {
      this.renderEntry(ul, entry);
    }
  }

  private renderFilters(container: HTMLElement): void {
    const filters = this.plugin.settings.timelineFilters;
    const controls = container.createDiv({ cls: "memento-timeline-controls" });

    const headerRow = controls.createDiv({ cls: "memento-search-header" });
    const searchButton = headerRow.createEl("button", {
      cls: "memento-search-button",
      attr: { type: "button" },
    });

    const filtersBody = controls.createDiv({ cls: "memento-filters-body" });

    const searchArea = filtersBody.createDiv({ cls: "memento-search-area" });
    const searchInput = searchArea.createEl("input", {
      type: "search",
      placeholder: "Search events",
      cls: "memento-search-input",
    }) as HTMLInputElement;
    searchInput.value = filters.search;

    const clearButton = searchArea.createEl("button", {
      cls: "memento-search-clear",
      attr: { type: "button", "aria-label": "Clear search" },
    });
    clearButton.textContent = "×";

    const filtersGroup = filtersBody.createDiv({
      cls: "memento-filters-group",
    });

    const applyVisibility = (
      visible: boolean,
      options: { focus?: boolean } = {},
    ) => {
      this.filtersExpanded = visible;
      filtersBody.toggleClass("is-visible", visible);
      searchButton.toggleClass("is-active", visible);
      searchButton.textContent = visible ? "Hide filters" : "Show filters";
      if (!visible) {
        searchInput.blur();
        this.shouldRestoreSearchFocus = false;
        this.searchCursorPosition = null;
      } else if (options.focus) {
        window.setTimeout(() => {
          searchInput.focus({ preventScroll: true });
          if (this.searchCursorPosition !== null) {
            const pos = this.searchCursorPosition;
            searchInput.setSelectionRange(pos, pos);
          }
          this.shouldRestoreSearchFocus = false;
          this.searchCursorPosition = null;
        }, 0);
      }
    };

    // Filters are collapsed by default and stay collapsed on every app start.
    // The panel only opens when the user explicitly toggles it open — it is
    // never auto-expanded from persisted (active) filter values.
    applyVisibility(this.filtersExpanded, {
      focus: this.shouldRestoreSearchFocus,
    });

    searchButton.addEventListener("click", () => {
      const shouldShow = !filtersBody.hasClass("is-visible");
      applyVisibility(shouldShow, { focus: shouldShow });
    });

    searchInput.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      filters.search = target.value;
      this.shouldRestoreSearchFocus = true;
      this.searchCursorPosition = target.selectionStart ?? target.value.length;
      void this.plugin.saveSettings();
    });

    clearButton.addEventListener("click", () => {
      if (searchInput.value.length > 0) {
        searchInput.value = "";
        filters.search = "";
        this.shouldRestoreSearchFocus = true;
        this.searchCursorPosition = 0;
        void this.plugin.saveSettings();
      } else {
        applyVisibility(false);
      }
    });

    this.addThemedDropdown(
      new Setting(filtersGroup).setName("Source"),
      [
        { value: "all", label: "All sources" },
        { value: "memento", label: "Memento only" },
        { value: "external", label: "External only" },
      ],
      filters.source,
      (value) => {
        filters.source = value as typeof filters.source;
        filters.sourceId = "";
        this.shouldRestoreSearchFocus = true;
        this.searchCursorPosition = null;
        void this.plugin.saveSettings();
      },
    );

    this.addThemedDropdown(
      new Setting(filtersGroup).setName("Calendar"),
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
        this.shouldRestoreSearchFocus = true;
        this.searchCursorPosition = null;
        void this.plugin.saveSettings();
      },
    );

    this.addThemedDropdown(
      new Setting(filtersGroup).setName("Date range"),
      [
        { value: "upcoming", label: "Upcoming" },
        { value: "week", label: "Next 7 days" },
        { value: "month", label: "Next month" },
        { value: "all", label: "All" },
      ],
      filters.dateRange,
      (value) => {
        filters.dateRange = value as typeof filters.dateRange;
        this.shouldRestoreSearchFocus = true;
        this.searchCursorPosition = null;
        void this.plugin.saveSettings();
      },
    );

    new Setting(filtersGroup).setName("Show completed").addToggle((toggle) =>
      toggle.setValue(filters.includeCompleted).onChange((value) => {
        filters.includeCompleted = value;
        this.shouldRestoreSearchFocus = true;
        this.searchCursorPosition = null;
        void this.plugin.saveSettings();
      }),
    );

    new Setting(filtersGroup).setName("Show archived").addToggle((toggle) =>
      toggle.setValue(filters.includeArchived).onChange((value) => {
        filters.includeArchived = value;
        this.shouldRestoreSearchFocus = true;
        this.searchCursorPosition = null;
        void this.plugin.saveSettings();
      }),
    );
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
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    });
  }

  private renderEntry(ul: HTMLElement, entry: TimelineEntry): void {
    const eventLi = ul.createEl("li", {
      cls: `memento-tl-event memento-tl-${entry.sourceType}`,
    });

    eventLi.addEventListener("click", () => {
      void this.openEntryActions(entry);
    });

    const quickBtn = eventLi.createDiv({ cls: "memento-tl-delete-btn" });
    setIcon(quickBtn, entry.editable ? "trash-2" : "eye-off");
    quickBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (entry.editable) {
        new ConfirmModal(
          this.plugin.app,
          "Delete Event",
          "Are you sure you want to permanently delete this event?",
          () => {
            this.plugin.deleteEvent(entry.event.id);
          },
          "Delete",
          true,
        ).open();
      } else {
        this.plugin.hideExternalEvent(entry.event.id);
      }
    });

    const contentDiv = eventLi.createDiv({ cls: "memento-tl-content" });
    const dateDiv = contentDiv.createDiv({ cls: "memento-tl-date" });
    dateDiv.createSpan({
      text: formatDateDisplay(entry.occurrenceDate),
      cls: "memento-tl-date-text main-date",
    });

    const metaDiv = contentDiv.createDiv({ cls: "memento-tl-time" });
    if (entry.occurrenceTime) {
      metaDiv.createSpan({
        text: formatTimeDisplay(entry.occurrenceTime),
        cls: "memento-tl-time-text",
      });
    }

    if (entry.event.recurrence !== "none") {
      metaDiv.createSpan({
        text: getRecurrenceLabel(entry.event),
        cls: "memento-tl-recurrence-badge",
      });
    }

    metaDiv.createSpan({
      text: entry.sourceName,
      cls: `memento-tl-source-badge memento-tl-source-${entry.sourceType}`,
    });

    this.renderRemaining(contentDiv, entry.occurrenceDate);

    const titleDiv = contentDiv.createDiv({ cls: "memento-tl-title" });
    titleDiv.createSpan({
      text: entry.event.title,
      cls: "memento-tl-title-text",
    });

    if (entry.event.context) {
      const contextDiv = contentDiv.createDiv({ cls: "memento-tl-context" });
      contextDiv.createEl("p", { text: entry.event.context });
    }

    if (isExternalEvent(entry.event) && entry.event.location) {
      const locationDiv = contentDiv.createDiv({ cls: "memento-tl-context" });
      locationDiv.createEl("p", { text: entry.event.location });
    }
  }

  private renderRemaining(
    container: HTMLElement,
    occurrenceDate: string,
  ): void {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
    const eventDate = new Date(occurrenceDate + "T00:00:00");
    const diffTime =
      eventDate.getTime() - new Date(todayStr + "T00:00:00").getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    let remainingText = "";
    if (diffDays === 0) {
      remainingText = "(Today)";
    } else if (diffDays === 1) {
      remainingText = "(Tomorrow)";
    } else if (diffDays > 1) {
      remainingText = `(${diffDays} days remaining)`;
    } else if (diffDays < 0) {
      remainingText = `(${-diffDays} days ago)`;
    }

    if (remainingText) {
      const remainingDiv = container.createDiv({
        cls: "memento-tl-remaining",
      });
      remainingDiv.createEl("em", { text: remainingText });
    }
  }

  private async openEntryActions(entry: TimelineEntry): Promise<void> {
    const filePath = this.plugin.getEventNotePath(
      entry.event,
      entry.occurrenceDate,
    );
    const fileExists = await this.plugin.app.vault.adapter.exists(filePath);

    new EventActionModal(this.plugin.app, entry, fileExists, {
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
      complete: () => {
        if (isMementoEvent(entry.event))
          this.plugin.setEventStatus(entry.event.id, "completed");
      },
      archive: () => {
        if (isMementoEvent(entry.event))
          this.plugin.setEventStatus(entry.event.id, "archived");
      },
      deleteEvent: () => {
        this.plugin.deleteEvent(entry.event.id);
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
    }).open();
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: "memento-empty-state" });
    const iconDiv = empty.createDiv({ cls: "memento-empty-icon" });
    setIcon(iconDiv, "calendar-days");

    empty.createEl("h3", { text: "No events found" });
    empty.createEl("p", {
      text: "Create a Memento event, adjust filters, or add an external ICS calendar in settings.",
      cls: "memento-empty-desc",
    });
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
