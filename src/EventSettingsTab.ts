import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type MementoPlugin from "./main";
import {
  ExternalCalendarSource,
  MementoEvent,
  formatDateDisplay,
  formatTimeDisplay,
  generateId,
  getRecurrenceLabel,
  getTodayStr,
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

    this.renderTimelineSettings(containerEl);
    this.renderExternalCalendars(containerEl);
    this.renderDataManagement(containerEl);
    this.renderEvents(containerEl);
  }

  private renderTimelineSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Timeline").setHeading();

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
  }

  private renderExternalCalendars(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("External Calendars").setHeading();

    let name = "";
    let url = "";
    let refreshIntervalMinutes = 60;

    new Setting(containerEl)
      .setName("Add ICS calendar")
      .setDesc("Use a private Google Calendar ICS URL or shared iCloud ICS URL")
      .addText((text) =>
        text.setPlaceholder("Calendar name").onChange((value) => {
          name = value.trim();
        }),
      )
      .addText((text) =>
        text.setPlaceholder("https://...ics").onChange((value) => {
          url = value.trim();
        }),
      )
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "5";
        text.setPlaceholder("Refresh minutes");
        text.setValue(refreshIntervalMinutes.toString());
        text.onChange((value) => {
          const parsed = parseInt(value, 10);
          refreshIntervalMinutes = Number.isNaN(parsed) ? 60 : Math.max(5, parsed);
        });
      })
      .addButton((button) =>
        button
          .setButtonText("Add")
          .setCta()
          .onClick(() => {
            if (!name || !url) {
              new Notice("Calendar name and ICS URL are required.");
              return;
            }
            this.plugin.addExternalCalendarSource({
              name,
              type: "ics",
              url,
              enabled: true,
              refreshIntervalMinutes,
            });
            this.render();
          }),
      );

    new Setting(containerEl)
      .setName("Refresh external calendars")
      .setDesc("Fetch all enabled ICS subscriptions now")
      .addButton((button) =>
        button.setButtonText("Refresh now").onClick(() => {
          void this.plugin.syncExternalCalendars().then(() => this.render());
        }),
      );

    for (const source of this.plugin.settings.externalCalendarSources) {
      this.renderExternalCalendarItem(containerEl, source);
    }
  }

  private renderExternalCalendarItem(
    containerEl: HTMLElement,
    source: ExternalCalendarSource,
  ): void {
    const sourceEvents = this.plugin.settings.externalEventsCache.filter(
      (event) => event.sourceId === source.id,
    );

    new Setting(containerEl)
      .setName(source.name)
      .setDesc(
        `${sourceEvents.length} cached events${
          source.lastFetchedAt ? ` · Last sync ${source.lastFetchedAt}` : ""
        }${source.lastError ? ` · Error: ${source.lastError}` : ""}`,
      )
      .addToggle((toggle) =>
        toggle.setValue(source.enabled).onChange((value) => {
          this.plugin.updateExternalCalendarSource({ ...source, enabled: value });
          this.render();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(() => {
          void this.plugin.syncExternalCalendars([source.id]).then(() => this.render());
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("Remove")
          .setWarning()
          .onClick(() => {
            this.plugin.deleteExternalCalendarSource(source.id);
            this.render();
          }),
      );
  }

  private renderDataManagement(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Data Management").setHeading();

    new Setting(containerEl)
      .setName("Export events")
      .setDesc("Create a JSON backup file in the vault root")
      .addButton((button) =>
        button.setButtonText("Export JSON").onClick(() => {
          void this.plugin.exportEventsToJson();
        }),
      );

    let importText = "";
    new Setting(containerEl)
      .setName("Import events")
      .setDesc("Paste a Memento JSON export. Duplicate ids are regenerated.")
      .addTextArea((text) =>
        text.setPlaceholder("Paste JSON").onChange((value) => {
          importText = value;
        }),
      )
      .addButton((button) =>
        button.setButtonText("Import JSON").onClick(() => {
          try {
            const count = this.plugin.importEventsFromJson(importText);
            new Notice(`Imported ${count} events.`);
            this.render();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Import failed: ${message}`);
          }
        }),
      );
  }

  private renderEvents(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Events")
      .setHeading()
      .settingEl.addClass("memento-settings-events-heading");

    new Setting(containerEl)
      .setName("Create a new event")
      .setDesc("Add a new event to your calendar")
      .addButton((button) =>
        button
          .setButtonText("+ Add Event")
          .setCta()
          .onClick(() => {
            new EventModal(this.app, (event) => {
              this.plugin.settings.events.push({
                ...event,
                id: event.id || generateId(),
                updatedAt: new Date().toISOString(),
              });
              void this.plugin.saveSettings().then(() => this.render());
            }).open();
          }),
      );

    const events = this.getFilteredEvents();

    if (events.length === 0) {
      const emptyDiv = containerEl.createDiv({ cls: "memento-settings-empty" });
      emptyDiv.createEl("p", {
        text: "No events yet. Create your first event above.",
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
  }

  private getFilteredEvents(): MementoEvent[] {
    let events = [...this.plugin.settings.events];

    if (!this.plugin.settings.showPastEventsInSettings) {
      const todayStr = getTodayStr();
      events = events.filter((event) => {
        if (event.status === "archived") return false;
        if (event.recurrence !== "none") return true;
        return event.date >= todayStr;
      });
    }

    events.sort((a, b) => a.date.localeCompare(b.date));
    return events;
  }

  private renderEventItem(container: HTMLElement, event: MementoEvent): void {
    const eventEl = container.createDiv({ cls: "memento-settings-event" });
    const infoEl = eventEl.createDiv({ cls: "memento-settings-event-info" });

    const titleRow = infoEl.createDiv({
      cls: "memento-settings-event-title-row",
    });
    titleRow.createSpan({
      text: event.title,
      cls: "memento-settings-event-title",
    });

    titleRow.createSpan({
      text: event.status || "active",
      cls: "memento-settings-event-badge",
    });

    if (event.recurrence !== "none") {
      titleRow.createSpan({
        text: getRecurrenceLabel(event),
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

    const actionsEl = eventEl.createDiv({
      cls: "memento-settings-event-actions",
    });

    this.addIconButton(actionsEl, "pencil", "Edit event", () => {
      new EventModal(
        this.app,
        (updatedEvent) => {
          this.plugin.updateEvent(updatedEvent);
          this.render();
        },
        event,
      ).open();
    });

    this.addIconButton(actionsEl, "copy", "Duplicate event", () => {
      this.plugin.duplicateEvent(event);
      this.render();
    });

    this.addIconButton(actionsEl, "check", "Mark complete", () => {
      this.plugin.setEventStatus(event.id, "completed");
      this.render();
    });

    this.addIconButton(actionsEl, "archive", "Archive event", () => {
      this.plugin.setEventStatus(event.id, "archived");
      this.render();
    });

    this.addIconButton(actionsEl, "trash-2", "Delete event", () => {
      this.plugin.deleteEvent(event.id);
      this.render();
    }).addClass("memento-settings-btn-delete");
  }

  private addIconButton(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLElement {
    const button = container.createEl("button", {
      cls: "memento-settings-btn",
      attr: { "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }
}
