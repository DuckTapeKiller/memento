import { ItemView, WorkspaceLeaf, Modal, Setting, App } from "obsidian";
import type MementoPlugin from "./main";
import {
  VIEW_TYPE_TIMELINE,
  getTimelineEntries,
  formatDateDisplay,
  formatTimeDisplay,
  RECURRENCE_LABELS,
  TimelineEntry,
} from "./types";

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
  onOpen() {
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
          btn.setWarning();
        } else {
          btn.setCta();
        }
      });
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class TimelineView extends ItemView {
  plugin: MementoPlugin;

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

  /**
   * Full re-render of the timeline
   */
  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("memento-timeline-container");

    const entries = getTimelineEntries(
      this.plugin.settings.events,
      this.plugin.settings.timelineViewMode,
    );

    if (entries.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    // Create the timeline wrapper
    const timelineWrapper = contentEl.createDiv({
      cls: "memento-timeline-wrapper",
    });

    const ul = timelineWrapper.createEl("ul", { cls: "memento-timeline" });

    for (const entry of entries) {
      // Single container for the entire event
      const eventLi = ul.createEl("li", { cls: "memento-tl-event" });

      // Make the event clickable
      eventLi.addEventListener("click", async () => {
        const filePath = this.plugin.getEventNotePath(
          entry.event,
          entry.occurrenceDate,
        );
        const fileExists = await this.plugin.app.vault.adapter.exists(filePath);

        if (fileExists) {
          await this.plugin.createNoteForEvent(
            entry.event,
            entry.occurrenceDate,
          );
        } else {
          new ConfirmModal(
            this.plugin.app,
            "Create Note",
            `Do you want to create a new note for "${entry.event.title}"?`,
            async () => {
              await this.plugin.createNoteForEvent(
                entry.event,
                entry.occurrenceDate,
              );
            },
            "Create Note",
            false,
          ).open();
        }
      });

      // Delete button (top right, visible on hover)
      const deleteBtn = eventLi.createDiv({ cls: "memento-tl-delete-btn" });
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation(); // prevent opening the note
        new ConfirmModal(
          this.plugin.app,
          "Delete Event",
          "Are you sure you want to permanently delete this event?",
          async () => {
            this.plugin.settings.events = this.plugin.settings.events.filter(
              (ev) => ev.id !== entry.event.id,
            );
            await this.plugin.saveSettings();
            this.render();
          },
          "Delete",
          true,
        ).open();
      });

      // Content container
      const contentDiv = eventLi.createDiv({ cls: "memento-tl-content" });

      // 1. DATE (Always show full date label)
      const dateDiv = contentDiv.createDiv({ cls: "memento-tl-date" });
      const dateLabel = formatDateDisplay(entry.occurrenceDate);
      dateDiv.createSpan({
        text: dateLabel,
        cls: "memento-tl-date-text main-date",
      });

      // 2. TIME
      if (entry.event.time) {
        const timeDiv = contentDiv.createDiv({ cls: "memento-tl-time" });
        timeDiv.createSpan({
          text: formatTimeDisplay(entry.event.time),
          cls: "memento-tl-time-text",
        });

        if (entry.event.recurrence !== "none") {
          timeDiv.createSpan({
            text: RECURRENCE_LABELS[entry.event.recurrence],
            cls: "memento-tl-recurrence-badge",
          });
        }
      } else if (entry.event.recurrence !== "none") {
        // No time, but has recurrence
        const timeDiv = contentDiv.createDiv({ cls: "memento-tl-time" });
        timeDiv.createSpan({
          text: RECURRENCE_LABELS[entry.event.recurrence],
          cls: "memento-tl-recurrence-badge",
        });
      }

      // DAYS REMAINING (Italic)
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      const eventDate = new Date(entry.occurrenceDate + "T00:00:00");
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
        const remainingDiv = contentDiv.createDiv({
          cls: "memento-tl-remaining",
        });
        remainingDiv.createEl("em", { text: remainingText });
      }

      // 3. TITLE
      const titleDiv = contentDiv.createDiv({ cls: "memento-tl-title" });
      titleDiv.createSpan({
        text: entry.event.title,
        cls: "memento-tl-title-text",
      });

      // 4. CONTEXT
      if (entry.event.context) {
        const contextDiv = contentDiv.createDiv({ cls: "memento-tl-context" });
        contextDiv.createEl("p", { text: entry.event.context });
      }
    }
  }

  /**
   * Render empty state when no events exist
   */
  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: "memento-empty-state" });

    const iconDiv = empty.createDiv({ cls: "memento-empty-icon" });
    iconDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path></svg>`;

    empty.createEl("h3", { text: "No upcoming events" });
    empty.createEl("p", {
      text: "Right-click a day in the calendar or use the command palette to create your first event.",
      cls: "memento-empty-desc",
    });
  }

  /**
   * Group timeline entries by date
   */
  private groupByDate(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
    const map = new Map<string, TimelineEntry[]>();
    for (const entry of entries) {
      const existing = map.get(entry.occurrenceDate);
      if (existing) {
        existing.push(entry);
      } else {
        map.set(entry.occurrenceDate, [entry]);
      }
    }
    return map;
  }
}
