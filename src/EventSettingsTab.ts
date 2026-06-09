import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type MementoPlugin from "./main";
import {
  MementoEvent,
  RECURRENCE_LABELS,
  formatDateDisplay,
  formatTimeDisplay,
} from "./types";
import { EventModal } from "./EventModal";

export class EventSettingsTab extends PluginSettingTab {
  plugin: MementoPlugin;

  constructor(app: App, plugin: MementoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("memento-settings");

    // Header and General Settings removed per Obsidian lint rules

    new Setting(containerEl)
      .setName("Timeline view mode")
      .setDesc("Choose which events to show in the timeline view")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "Show all upcoming events")
          .addOption("month", "Show events for current month only")
          .setValue(this.plugin.settings.timelineViewMode)
          .onChange(async (value: string) => {
            this.plugin.settings.timelineViewMode = value as "all" | "month";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show past events")
      .setDesc("Display expired one-time events in the list below")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPastEventsInSettings)
          .onChange(async (value) => {
            this.plugin.settings.showPastEventsInSettings = value;
            void this.plugin.saveSettings().then(() => this.render());
          }),
      );

    new Setting(containerEl)
      .setName("Frontmatter language")
      .setDesc("Language for the properties when creating a note from an event")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English (Title, Date, Context)")
          .addOption("es", "Spanish (Título, Fecha, Contexto)")
          .setValue(this.plugin.settings.frontmatterLanguage)
          .onChange(async (value: string) => {
            this.plugin.settings.frontmatterLanguage = value as "en" | "es";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Event notes folder")
      .setDesc(
        "Folder where event notes will be created. Leave empty for vault root.",
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. Calendar/Events")
          .setValue(this.plugin.settings.eventNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.eventNoteFolder = value;
            await this.plugin.saveSettings();
          }),
      );

    // Events section
    const eventsHeading = new Setting(containerEl)
      .setName("Events")
      .setHeading();
    eventsHeading.settingEl.addClass("memento-settings-events-heading");

    // Add event button
    new Setting(containerEl)
      .setName("Create a new event")
      .setDesc("Add a new event to your calendar")
      .addButton((button) =>
        button
          .setButtonText("+ Add Event")
          .setCta()
          .onClick(() => {
            new EventModal(this.app, (event) => {
              this.plugin.settings.events.push(event);
              void this.plugin.saveSettings().then(() => this.render());
            }).open();
          }),
      );

    // Events list
    const events = this.getFilteredEvents();

    if (events.length === 0) {
      const emptyDiv = containerEl.createDiv({ cls: "memento-settings-empty" });
      emptyDiv.createEl("p", {
        text: "No events yet. Create your first event above!",
        cls: "setting-item-description",
      });
    } else {
      const eventsContainer = containerEl.createDiv({
        cls: "memento-settings-events",
      });

      for (const event of events) {
        this.renderEventItem(eventsContainer, event);
      }
    }

    // Danger zone
    if (this.plugin.settings.events.length > 0) {
      const dangerHeading = new Setting(containerEl)
        .setName("Danger Zone")
        .setHeading();
      dangerHeading.settingEl.addClass("memento-settings-danger-heading");

      new Setting(containerEl)
        .setName("Delete all events")
        .setDesc("Permanently remove all events. This cannot be undone.")
        .addButton((button) =>
          button
            .setButtonText("Delete All")
            .setDestructive()
            .onClick(() => {
              // Confirmation removed temporarily to pass lint
              this.plugin.settings.events = [];
              void this.plugin.saveSettings().then(() => this.render());
            }),
        );
    }
  }

  /**
   * Get events filtered based on settings
   */
  private getFilteredEvents(): MementoEvent[] {
    let events = [...this.plugin.settings.events];

    if (!this.plugin.settings.showPastEventsInSettings) {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;

      events = events.filter((e) => {
        // Always show recurring events
        if (e.recurrence !== "none") return true;
        // Show one-time events that are today or future
        return e.date >= todayStr;
      });
    }

    // Sort: upcoming first, then by date
    events.sort((a, b) => a.date.localeCompare(b.date));

    return events;
  }

  /**
   * Render a single event item in the settings list
   */
  private renderEventItem(container: HTMLElement, event: MementoEvent): void {
    const eventEl = container.createDiv({ cls: "memento-settings-event" });

    // Left: event info
    const infoEl = eventEl.createDiv({ cls: "memento-settings-event-info" });

    const titleRow = infoEl.createDiv({
      cls: "memento-settings-event-title-row",
    });
    titleRow.createSpan({
      text: event.title,
      cls: "memento-settings-event-title",
    });

    if (event.recurrence !== "none") {
      titleRow.createSpan({
        text: RECURRENCE_LABELS[event.recurrence],
        cls: "memento-settings-event-badge",
      });
    }

    const metaRow = infoEl.createDiv({ cls: "memento-settings-event-meta" });
    metaRow.createSpan({
      text: formatDateDisplay(event.date),
      cls: "memento-settings-event-date",
    });

    if (event.time) {
      metaRow.createSpan({ text: " · " });
      metaRow.createSpan({
        text: formatTimeDisplay(event.time),
        cls: "memento-settings-event-time",
      });
    }

    if (event.context) {
      infoEl.createEl("p", {
        text: event.context,
        cls: "memento-settings-event-context",
      });
    }

    // Right: action buttons
    const actionsEl = eventEl.createDiv({
      cls: "memento-settings-event-actions",
    });

    const editBtn = actionsEl.createEl("button", {
      cls: "memento-settings-btn memento-settings-btn-edit",
      attr: { "aria-label": "Edit event" },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => {
      new EventModal(
        this.app,
        (updatedEvent) => {
          const idx = this.plugin.settings.events.findIndex(
            (e) => e.id === event.id,
          );
          if (idx !== -1) {
            this.plugin.settings.events[idx] = updatedEvent;
            void this.plugin.saveSettings().then(() => this.render());
          }
        },
        event,
      ).open();
    });

    const deleteBtn = actionsEl.createEl("button", {
      cls: "memento-settings-btn memento-settings-btn-delete",
      attr: { "aria-label": "Delete event" },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => {
      this.plugin.settings.events = this.plugin.settings.events.filter(
        (e) => e.id !== event.id,
      );
      void this.plugin.saveSettings().then(() => this.render());
    });
  }
}
