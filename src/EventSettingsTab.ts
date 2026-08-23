import {
  App,
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  setIcon,
} from "obsidian";
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

  /**
   * Declarative mirror of the settings this tab renders, so they are reachable
   * from Obsidian 1.13's settings search. Rendering still goes through
   * display() — these definitions describe the same keys, and the framework
   * reads and writes them through getControlValue/setControlValue below.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Startup and indicators",
        items: [
          {
            name: "Open timeline on startup",
            desc: "Force the timeline panel open every time Obsidian starts. When off, Obsidian simply restores the panel if you left it open.",
            control: { type: "toggle", key: "openTimelineOnStartup" },
          },
          {
            name: "Show pending count in status bar",
            desc: "Show a calendar icon and the pending event count in the status bar. Click it to open the timeline. Not available on mobile.",
            visible: () => !Platform.isMobile,
            control: { type: "toggle", key: "showStatusBarCount" },
          },
          {
            name: "Show pending count on ribbon icon",
            desc: "Show the pending event count as a badge on the Memento ribbon icon. Works on desktop and mobile.",
            control: { type: "toggle", key: "showRibbonBadge" },
          },
          {
            name: "Pending count covers",
            desc: "How far ahead the pending count looks.",
            control: {
              type: "dropdown",
              key: "pendingCountWindow",
              options: {
                today: "Today only",
                week: "Next 7 days",
                month: "Next 30 days",
                all: "All upcoming",
              },
            },
          },
          {
            name: "Include overdue events",
            desc: "Also count one-time events that are past due and still active, plus events earlier today whose time has passed. Recurring and external events are never counted as overdue.",
            control: { type: "toggle", key: "pendingIncludeOverdue" },
          },
        ],
      },
      {
        type: "group",
        heading: "Timeline",
        items: [
          {
            name: "Timeline view mode",
            desc: "Choose which events to show in the timeline view.",
            control: {
              type: "dropdown",
              key: "timelineViewMode",
              options: {
                all: "Show all upcoming events",
                month: "Show events for current month only",
              },
            },
          },
          {
            name: "Show past events",
            desc: "Display expired one-time events in the list below.",
            control: { type: "toggle", key: "showPastEventsInSettings" },
          },
          {
            name: "Frontmatter language",
            desc: "Language for the properties when creating a note from an event.",
            aliases: ["Title", "Date", "Context", "Fecha", "Contexto"],
            control: {
              type: "dropdown",
              key: "frontmatterLanguage",
              options: {
                en: "English (Title, Date, Context)",
                es: "Spanish (Título, Fecha, Contexto)",
              },
            },
          },
          {
            name: "Event notes folder",
            desc: "Folder where event notes will be created. Leave empty for vault root.",
            control: {
              type: "text",
              key: "eventNoteFolder",
              placeholder: "E.g. Calendar/events",
            },
          },
        ],
      },
      // The remaining sections are dynamic collections rather than fixed
      // key-backed controls, so they are drawn imperatively into the row
      // Obsidian gives them.
      this.imperativeSection("External calendars", (host) =>
        this.renderExternalCalendars(host),
      ),
      this.imperativeSection("Data management", (host) =>
        this.renderDataManagement(host),
      ),
      this.imperativeSection("Events", (host) => this.renderEvents(host)),
    ];
  }

  /**
   * Wraps an imperative section as a setting definition. The generated row is
   * hidden and the section is drawn into a container of its own, removed again
   * on teardown so repeated renders cannot stack duplicates.
   */
  private imperativeSection(
    name: string,
    draw: (host: HTMLElement) => void,
  ): SettingDefinitionItem {
    return {
      name,
      render: (setting: Setting) => {
        // Obsidian owns this row and discards anything written outside it, so
        // the section is drawn into the row itself, stripped back to a plain
        // block container first.
        setting.settingEl.empty();
        setting.settingEl.addClass("memento-settings-section");
        draw(setting.settingEl);
      },
    };
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    // Route through saveSettings so the timeline, calendar decorations and
    // pending indicators refresh exactly as they do from the rendered tab.
    await this.plugin.saveSettings();
  }

  private renderExternalCalendars(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("External calendars").setHeading();

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
            this.update();
          }),
      );

    new Setting(containerEl)
      .setName("Refresh external calendars")
      .setDesc("Fetch all enabled ICS subscriptions now")
      .addButton((button) =>
        button.setButtonText("Refresh now").onClick(() => {
          void this.plugin.syncExternalCalendars().then(() => this.update());
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
          this.update();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(() => {
          void this.plugin.syncExternalCalendars([source.id]).then(() => this.update());
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("Remove")
          .setDestructive()
          .onClick(() => {
            this.plugin.deleteExternalCalendarSource(source.id);
            this.update();
          }),
      );
  }

  private renderDataManagement(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Data management").setHeading();

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
            this.update();
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
          .setButtonText("Add event")
          .setCta()
          .onClick(() => {
            new EventModal(this.app, (event) => {
              this.plugin.settings.events.push({
                ...event,
                id: event.id || generateId(),
                updatedAt: new Date().toISOString(),
              });
              void this.plugin.saveSettings().then(() => this.update());
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
          this.update();
        },
        event,
      ).open();
    });

    this.addIconButton(actionsEl, "copy", "Duplicate event", () => {
      this.plugin.duplicateEvent(event);
      this.update();
    });

    this.addIconButton(actionsEl, "check", "Mark complete", () => {
      this.plugin.setEventStatus(event.id, "completed");
      this.update();
    });

    this.addIconButton(actionsEl, "archive", "Archive event", () => {
      this.plugin.setEventStatus(event.id, "archived");
      this.update();
    });

    this.addIconButton(actionsEl, "trash-2", "Delete event", () => {
      this.plugin.deleteEvent(event.id);
      this.update();
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
