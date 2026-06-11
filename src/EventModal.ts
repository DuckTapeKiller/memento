import { App, Modal, Setting, DropdownComponent } from "obsidian";
import {
  MementoEvent,
  RecurrenceType,
  EventStatus,
  RECURRENCE_LABELS,
  generateId,
  formatDateDisplay,
  getTodayStr,
} from "./types";

export class EventModal extends Modal {
  private event: Partial<MementoEvent>;
  private onSubmit: (event: MementoEvent) => void;
  private isEditing: boolean;

  constructor(
    app: App,
    onSubmit: (event: MementoEvent) => void,
    existingEvent?: MementoEvent,
    prefilledDate?: string,
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.isEditing = !!existingEvent;

    if (existingEvent) {
      this.event = { ...existingEvent };
    } else {
      this.event = {
        id: generateId(),
        date: prefilledDate || getTodayStr(),
        time: "",
        title: "",
        context: "",
        recurrence: "none",
        recurrenceInterval: 1,
        status: "active",
        notePaths: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.addClass("memento-modal");
    modalEl.addClass("memento-modal-container");

    // Scroll focused inputs to top middle section on mobile
    contentEl.addEventListener("focusin", (e: FocusEvent) => {
      if (!activeDocument.body.classList.contains("is-mobile")) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        const scrollTarget = target.closest(".setting-item") as HTMLElement || target;
        window.setTimeout(() => {
          const containerRect = contentEl.getBoundingClientRect();
          const targetRect = scrollTarget.getBoundingClientRect();
          // Offset by roughly 20% of the screen height to place it in the "top middle"
          const offset = window.innerHeight * 0.2;
          contentEl.scrollTo({
            top: contentEl.scrollTop + (targetRect.top - containerRect.top) - offset,
            behavior: "smooth"
          });
        }, 300);
      }
    });

    // Header
    const header = contentEl.createDiv({ cls: "memento-modal-header" });
    header.createEl("h2", {
      text: this.isEditing ? "Edit Event" : "Create Event",
      cls: "memento-modal-title",
    });

    // Date display badge
    const dateBadge = header.createDiv({ cls: "memento-date-badge" });
    const updateDateBadge = () => {
      dateBadge.empty();
      dateBadge.createSpan({
        text: formatDateDisplay(this.event.date || getTodayStr()),
        cls: "memento-date-badge-text",
      });
    };
    updateDateBadge();

    // Form container
    const form = contentEl.createDiv({ cls: "memento-form" });

    // Date field
    new Setting(form)
      .setName("Date")
      .setDesc("When does this event occur?")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.event.date || getTodayStr());
        text.onChange((value) => {
          this.event.date = value;
          updateDateBadge();
        });
        text.inputEl.addClass("memento-date-input");
      });

    new Setting(form)
      .setName("End date")
      .setDesc("Optional end date for longer events")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.event.endDate || "");
        text.onChange((value) => {
          this.event.endDate = value || undefined;
        });
        text.inputEl.addClass("memento-date-input");
      });

    // Time field (Custom Obsidian Dropdowns)
    let currentHour = "--";
    let currentMin = "--";
    if (this.event.time) {
      const [h, m] = this.event.time.split(":");
      currentHour = h;
      currentMin = m;
    }

    const timeSetting = new Setting(form)
      .setName("Time")
      .setDesc("What time? (optional)");

    // Hour Input
    timeSetting.addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.max = "23";
      text.inputEl.placeholder = "HH";
      text.inputEl.setCssStyles({ width: "4rem", textAlign: "center" });
      text.setValue(currentHour !== "--" ? currentHour : "");
      text.onChange((value) => {
        let val = parseInt(value, 10);
        if (isNaN(val)) {
          currentHour = "--";
        } else {
          if (val < 0) val = 0;
          if (val > 23) val = 23;
          currentHour = val.toString().padStart(2, "0");
          text.setValue(currentHour); // Auto-format to 2 digits
        }
        updateTime();
      });
    });

    // Add a visual separator
    const separator = timeSetting.controlEl.createSpan({
      text: " : ",
      cls: "memento-time-separator",
    });
    separator.setCssStyles({ margin: "0 0.2rem", fontWeight: "bold" });

    // Minute Input
    timeSetting.addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.max = "59";
      text.inputEl.placeholder = "MM";
      text.inputEl.setCssStyles({ width: "4rem", textAlign: "center" });
      text.setValue(currentMin !== "--" ? currentMin : "");
      text.onChange((value) => {
        let val = parseInt(value, 10);
        if (isNaN(val)) {
          currentMin = "--";
        } else {
          if (val < 0) val = 0;
          if (val > 59) val = 59;
          currentMin = val.toString().padStart(2, "0");
          text.setValue(currentMin); // Auto-format to 2 digits
        }
        updateTime();
      });
    });

    const updateTime = () => {
      if (currentHour === "--" && currentMin === "--") {
        this.event.time = "";
      } else {
        const h = currentHour === "--" ? "12" : currentHour;
        const m = currentMin === "--" ? "00" : currentMin;
        this.event.time = `${h}:${m}`;
      }
    };

    let currentEndHour = "--";
    let currentEndMin = "--";
    if (this.event.endTime) {
      const [h, m] = this.event.endTime.split(":");
      currentEndHour = h;
      currentEndMin = m;
    }

    const endTimeSetting = new Setting(form)
      .setName("End time")
      .setDesc("Optional end time");

    endTimeSetting.addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.max = "23";
      text.inputEl.placeholder = "HH";
      text.inputEl.setCssStyles({ width: "4rem", textAlign: "center" });
      text.setValue(currentEndHour !== "--" ? currentEndHour : "");
      text.onChange((value) => {
        let val = parseInt(value, 10);
        if (isNaN(val)) {
          currentEndHour = "--";
        } else {
          if (val < 0) val = 0;
          if (val > 23) val = 23;
          currentEndHour = val.toString().padStart(2, "0");
          text.setValue(currentEndHour);
        }
        updateEndTime();
      });
    });

    endTimeSetting.controlEl
      .createSpan({
        text: " : ",
        cls: "memento-time-separator",
      })
      .setCssStyles({ margin: "0 0.2rem", fontWeight: "bold" });

    endTimeSetting.addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.max = "59";
      text.inputEl.placeholder = "MM";
      text.inputEl.setCssStyles({ width: "4rem", textAlign: "center" });
      text.setValue(currentEndMin !== "--" ? currentEndMin : "");
      text.onChange((value) => {
        let val = parseInt(value, 10);
        if (isNaN(val)) {
          currentEndMin = "--";
        } else {
          if (val < 0) val = 0;
          if (val > 59) val = 59;
          currentEndMin = val.toString().padStart(2, "0");
          text.setValue(currentEndMin);
        }
        updateEndTime();
      });
    });

    const updateEndTime = () => {
      if (currentEndHour === "--" && currentEndMin === "--") {
        this.event.endTime = "";
      } else {
        const h = currentEndHour === "--" ? "12" : currentEndHour;
        const m = currentEndMin === "--" ? "00" : currentEndMin;
        this.event.endTime = `${h}:${m}`;
      }
    };

    // Title field
    let titleInput: HTMLInputElement;
    new Setting(form)
      .setName("Title")
      .setDesc("Give your event a name")
      .addText((text) => {
        text.setPlaceholder("e.g. Team standup, Dentist appointment...");
        text.setValue(this.event.title || "");
        text.onChange((value) => {
          this.event.title = value;
        });
        titleInput = text.inputEl;
        titleInput.addClass("memento-title-input");
      });

    // Context / description field
    new Setting(form)
      .setName("Context")
      .setDesc("Additional details about the event")
      .addTextArea((text) => {
        text.setPlaceholder("Add context, notes, or details...");
        text.setValue(this.event.context || "");
        text.onChange((value) => {
          this.event.context = value;
        });
        text.inputEl.addClass("memento-context-input");
        text.inputEl.rows = 3;
      });

    // Recurrence field
    new Setting(form)
      .setName("Recurrence")
      .setDesc("Does this event repeat?")
      .addDropdown((dropdown: DropdownComponent) => {
        for (const [value, label] of Object.entries(RECURRENCE_LABELS)) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.event.recurrence || "none");
        dropdown.onChange((value) => {
          this.event.recurrence = value as RecurrenceType;
        });
      });

    new Setting(form)
      .setName("Repeat interval")
      .setDesc("Use 1 for every day/week/month/year, 2 for every other, etc.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue((this.event.recurrenceInterval || 1).toString());
        text.onChange((value) => {
          const parsed = parseInt(value, 10);
          this.event.recurrenceInterval =
            Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
        });
      });

    new Setting(form)
      .setName("Repeat until")
      .setDesc("Optional recurrence end date")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.event.recurrenceEndDate || "");
        text.onChange((value) => {
          this.event.recurrenceEndDate = value || undefined;
        });
      });

    new Setting(form)
      .setName("Repeat count")
      .setDesc("Optional maximum number of occurrences")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(this.event.recurrenceCount?.toString() || "");
        text.onChange((value) => {
          const parsed = parseInt(value, 10);
          this.event.recurrenceCount =
            Number.isNaN(parsed) || parsed < 1 ? undefined : parsed;
        });
      });

    new Setting(form)
      .setName("Status")
      .setDesc("Completed and archived events are hidden unless enabled")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown
          .addOption("active", "Active")
          .addOption("completed", "Completed")
          .addOption("archived", "Archived")
          .setValue(this.event.status || "active")
          .onChange((value) => {
            this.event.status = value as EventStatus;
          });
      });

    // Buttons
    const buttonRow = contentEl.createDiv({ cls: "memento-button-row" });

    const cancelBtn = buttonRow.createEl("button", {
      text: "Cancel",
      cls: "memento-btn memento-btn-secondary",
    });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = buttonRow.createEl("button", {
      text: this.isEditing ? "Save Changes" : "Create Event",
      cls: "memento-btn memento-btn-primary",
    });
    submitBtn.addEventListener("click", () => this.handleSubmit());

    // Focus title input after render
    window.setTimeout(() => {
      if (titleInput) titleInput.focus();
    }, 50);

    // Enter key to submit
    this.scope.register([], "Enter", (e) => {
      // Only submit if not in textarea
      if (activeDocument.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        this.handleSubmit();
      }
    });
  }

  private handleSubmit(): void {
    if (!this.event.title?.trim()) {
      // Shake the modal to indicate validation error
      this.contentEl.addClass("memento-shake");
      window.setTimeout(() => this.contentEl.removeClass("memento-shake"), 500);
      return;
    }

    const fullEvent: MementoEvent = {
      id: this.event.id || generateId(),
      date: this.event.date || getTodayStr(),
      time: this.event.time || "",
      endDate: this.event.endDate || undefined,
      endTime: this.event.endTime || "",
      title: this.event.title.trim(),
      context: this.event.context?.trim() || "",
      recurrence: this.event.recurrence || "none",
      recurrenceInterval: Math.max(1, this.event.recurrenceInterval || 1),
      recurrenceEndDate: this.event.recurrenceEndDate || undefined,
      recurrenceCount: this.event.recurrenceCount,
      status: this.event.status || "active",
      notePaths: this.event.notePaths || {},
      createdAt: this.event.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.onSubmit(fullEvent);
    this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
