import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import {
  MementoSettings,
  DEFAULT_SETTINGS,
  VIEW_TYPE_TIMELINE,
  MementoEvent,
} from "./types";
import { EventModal } from "./EventModal";
import { TimelineView } from "./TimelineView";
import { CalendarDecorator } from "./CalendarDecorator";
import { EventSettingsTab } from "./EventSettingsTab";

export default class MementoPlugin extends Plugin {
  settings!: MementoSettings;
  private decorator!: CalendarDecorator;

  async onload(): Promise<void> {
    // Load settings
    await this.loadSettings();

    // Register the timeline view
    this.registerView(VIEW_TYPE_TIMELINE, (leaf: WorkspaceLeaf) => {
      return new TimelineView(leaf, this);
    });

    // Register settings tab
    this.addSettingTab(new EventSettingsTab(this.app, this));

    // Set up calendar decorator (DOM observer + context menu)
    this.decorator = new CalendarDecorator(this);

    // Commands
    this.addCommand({
      id: "create-event",
      name: "Create a new event",
      callback: () => {
        void this.openCreateEventModal();
      },
    });

    this.addCommand({
      id: "create-event-today",
      name: "Create event for today",
      callback: () => {
        void this.createEventForDate(this.getTodayStr());
      },
    });

    this.addCommand({
      id: "open-timeline",
      name: "Open event timeline",
      callback: () => {
        void this.activateTimelineView();
      },
    });

    // Ribbon icon
    this.addRibbonIcon("calendar-clock", "Memento — Event Timeline", () => {
      void this.activateTimelineView();
    });

    this.app.workspace.onLayoutReady(() => {
      this.decorator.start();
      void this.activateTimelineView();
    });

    // Set up periodic refresh (check once per minute for event expiry)
    this.registerInterval(
      window.setInterval(() => {
        this.refreshTimeline();
        this.decorator.refresh();
      }, 60 * 1000),
    );
  }

  onunload(): void {
    // Clean up decorator
    if (this.decorator) {
      this.decorator.destroy();
    }

    // Detach all timeline views
    this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE).forEach((leaf) => {
      leaf.detach();
    });
  }

  // ─── Settings Persistence ────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshTimeline();
    this.decorator?.refresh();
  }

  // ─── Event Management ────────────────────────────────────────────

  /**
   * Open the create event modal (no date pre-filled — user picks)
   */
  openCreateEventModal(): void {
    new EventModal(this.app, (event: MementoEvent) => {
      this.settings.events.push(event);
      void this.saveSettings();
    }).open();
  }

  /**
   * Open the create event modal for a specific date
   */
  createEventForDate(dateStr: string): void {
    new EventModal(
      this.app,
      (event: MementoEvent) => {
        this.settings.events.push(event);
        void this.saveSettings();
      },
      undefined,
      dateStr,
    ).open();
  }

  getEventNotePath(event: MementoEvent, occurrenceDate: string): string {
    const folderPath = this.settings.eventNoteFolder.trim();
    const safeTitle = event.title.replace(/[\\/:"*?<>|#^[\]]/g, "").trim();
    const filename = `${occurrenceDate} - ${safeTitle}.md`;
    return folderPath ? `${folderPath}/${filename}` : filename;
  }

  /**
   * Create or open a note for a specific event
   */
  async createNoteForEvent(
    event: MementoEvent,
    occurrenceDate: string,
  ): Promise<void> {
    const { vault, workspace } = this.app;
    const folderPath = this.settings.eventNoteFolder.trim();

    // Create folder if it doesn't exist
    if (folderPath !== "") {
      const folderExists = await vault.adapter.exists(folderPath);
      if (!folderExists) {
        await vault.createFolder(folderPath);
      }
    }

    const filePath = this.getEventNotePath(event, occurrenceDate);

    const abstractFile = vault.getAbstractFileByPath(filePath);
    let file: TFile | null = null;
    if (abstractFile instanceof TFile) {
      file = abstractFile;
    }

    if (!file) {
      const isEs = this.settings.frontmatterLanguage === "es";
      const titleKey = isEs ? "Título" : "Title";
      const dateKey = isEs ? "Fecha" : "Date";
      const contextKey = isEs ? "Contexto" : "Context";

      const dateTimeStr = event.time
        ? `${occurrenceDate} ${event.time}`
        : occurrenceDate;
      const safeTitleVal = event.title.replace(/"/g, '\\"');
      const safeContextVal = event.context
        ? event.context.replace(/"/g, '\\"').replace(/\n/g, "\\n")
        : "";

      let content = `---\n`;
      content += `${titleKey}: "${safeTitleVal}"\n`;
      content += `${dateKey}: ${dateTimeStr}\n`;
      if (safeContextVal) {
        content += `${contextKey}: "${safeContextVal}"\n`;
      } else {
        content += `${contextKey}: ""\n`;
      }
      content += `---\n\n# ${event.title}\n`;

      file = await vault.create(filePath, content);
    }

    // Open the file
    const leaf = workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  // ─── Timeline View ───────────────────────────────────────────────

  /**
   * Activate (open/reveal) the timeline view in the right sidebar
   */
  async activateTimelineView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)[0];

    if (!leaf) {
      // Try to place it below the calendar in the right sidebar
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

  /**
   * Refresh the timeline view contents
   */
  refreshTimeline(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of leaves) {
      if (leaf.view instanceof TimelineView) {
        leaf.view.render();
      }
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────

  private getTodayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
  }
}
