import {
  App,
  ButtonComponent,
  DropdownComponent,
  ExtraButtonComponent,
  Modal,
  Setting,
  TextAreaComponent,
  TextComponent,
} from "obsidian";
import {
  MementoEvent,
  RecurrenceType,
  EventStatus,
  RECURRENCE_LABELS,
  generateId,
  getTodayStr,
} from "./types";

/** Singular and plural unit after "Every n" in the repeat details. */
const REPEAT_UNITS: Record<Exclude<RecurrenceType, "none">, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

export class EventModal extends Modal {
  private event: Partial<MementoEvent>;
  private onSubmit: (event: MementoEvent) => void;
  private isEditing: boolean;
  private titleInput: HTMLInputElement | null = null;
  private titleError: HTMLElement | null = null;

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
    this.setTitle(this.isEditing ? "Edit event" : "New event");

    // Scroll focused inputs to top middle section on mobile
    contentEl.addEventListener("focusin", (e: FocusEvent) => {
      // The modal's own document, not the last-focused window's.
      if (!contentEl.ownerDocument.body.classList.contains("is-mobile")) return;
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

    // What: the title, then free notes.
    const title = new TextComponent(contentEl)
      .setPlaceholder("Event title")
      .setValue(this.event.title || "")
      .onChange((value) => {
        this.event.title = value;
        title.inputEl.removeAttribute("aria-invalid");
        this.titleError?.addClass("memento-is-hidden");
      });
    title.inputEl.addClass("memento-title-input");
    title.inputEl.setAttribute("aria-label", "Title");
    this.titleInput = title.inputEl;
    this.titleError = contentEl.createDiv({
      cls: "memento-field-error memento-is-hidden",
      text: "Add a title to save the event.",
    });

    const notes = new TextAreaComponent(contentEl)
      .setPlaceholder("Notes")
      .setValue(this.event.context || "")
      .onChange((value) => {
        this.event.context = value;
      });
    notes.inputEl.addClass("memento-context-input");
    notes.inputEl.setAttribute("aria-label", "Context");
    notes.inputEl.rows = 3;

    // When: start, an optional end, and how it repeats.
    const form = contentEl.createDiv({ cls: "memento-form" });

    const starts = new Setting(form).setName("Starts");
    this.addDateInput(starts, this.event.date || getTodayStr(), (value) => {
      this.event.date = value;
    });
    this.addTimeInputs(starts, this.event.time || "", (value) => {
      this.event.time = value;
    });

    const hasEnd = !!(this.event.endDate || this.event.endTime);
    const ends = new Setting(form).setName("Ends");
    ends.settingEl.addClass("memento-ends-row");
    const endDate = this.addDateInput(ends, this.event.endDate || "", (value) => {
      this.event.endDate = value || undefined;
    });
    const endTime = this.addTimeInputs(ends, this.event.endTime || "", (value) => {
      this.event.endTime = value;
    });

    const addEnd = form.createEl("a", {
      cls: "memento-link-button",
      text: "Add end",
      attr: { role: "button", tabindex: "0" },
    });
    const showEnd = (visible: boolean) => {
      ends.settingEl.toggleClass("memento-is-hidden", !visible);
      addEnd.toggleClass("memento-is-hidden", visible);
    };
    const openEnd = () => {
      showEnd(true);
      endDate.inputEl.focus();
    };
    addEnd.addEventListener("click", openEnd);
    addEnd.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      evt.stopPropagation();
      openEnd();
    });
    new ExtraButtonComponent(ends.controlEl)
      .setIcon("x")
      .setTooltip("Remove end")
      .onClick(() => {
        endDate.setValue("");
        endTime.clear();
        this.event.endDate = undefined;
        this.event.endTime = "";
        showEnd(false);
      });
    // The end sits right under the start, before the link that adds it.
    form.insertBefore(addEnd, ends.settingEl.nextSibling);
    showEnd(hasEnd);

    const repeat = new Setting(form).setName("Repeat");
    const details = form.createDiv({ cls: "memento-repeat-details" });

    const everySetting = new Setting(details).setName("Every");
    everySetting.addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.addClass("memento-number-input");
      text.setValue((this.event.recurrenceInterval || 1).toString());
      text.onChange((value) => {
        const parsed = parseInt(value, 10);
        this.event.recurrenceInterval =
          Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
        updateRepeat();
      });
    });
    const unitEl = everySetting.controlEl.createSpan({ cls: "memento-unit" });

    const untilSetting = new Setting(details).setName("Until");
    this.addDateInput(untilSetting, this.event.recurrenceEndDate || "", (value) => {
      this.event.recurrenceEndDate = value || undefined;
    });

    new Setting(details)
      .setName("Occurrences")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.addClass("memento-number-input");
        text.setPlaceholder("–");
        text.setValue(this.event.recurrenceCount?.toString() || "");
        text.onChange((value) => {
          const parsed = parseInt(value, 10);
          this.event.recurrenceCount =
            Number.isNaN(parsed) || parsed < 1 ? undefined : parsed;
        });
      });

    const updateRepeat = () => {
      const recurrence = this.event.recurrence || "none";
      details.toggleClass("memento-is-hidden", recurrence === "none");
      if (recurrence !== "none") {
        const [one, many] = REPEAT_UNITS[recurrence];
        unitEl.setText((this.event.recurrenceInterval || 1) === 1 ? one : many);
      }
    };

    repeat.addDropdown((dropdown: DropdownComponent) => {
      for (const [value, label] of Object.entries(RECURRENCE_LABELS)) {
        dropdown.addOption(value, label);
      }
      dropdown.setValue(this.event.recurrence || "none");
      dropdown.onChange((value) => {
        this.event.recurrence = value as RecurrenceType;
        updateRepeat();
      });
    });
    // The details belong under the dropdown that opens them.
    form.insertBefore(details, repeat.settingEl.nextSibling);
    updateRepeat();

    new Setting(form)
      .setName("High priority")
      .setDesc("Keep it highlighted in the timeline.")
      .addToggle((toggle) =>
        toggle.setValue(!!this.event.highPriority).onChange((value) => {
          this.event.highPriority = value;
        }),
      );

    // A new event is always active, so the status only matters when editing.
    if (this.isEditing) {
      new Setting(form)
        .setName("Status")
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
    }

    const buttons = contentEl.createDiv({
      cls: "modal-button-container memento-modal-buttons",
    });
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => {
      this.close();
    });
    new ButtonComponent(buttons)
      .setButtonText(this.isEditing ? "Save" : "Create event")
      .setCta()
      .onClick(() => {
        this.handleSubmit();
      });

    // Focus title input after render
    window.setTimeout(() => {
      title.inputEl.focus();
    }, 50);

    // Enter key to submit
    this.scope.register([], "Enter", (e) => {
      // Only submit if not in textarea
      if (this.containerEl.ownerDocument.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        this.handleSubmit();
      }
    });
  }

  private addDateInput(
    setting: Setting,
    value: string,
    onChange: (value: string) => void,
  ): TextComponent {
    const text = new TextComponent(setting.controlEl);
    text.inputEl.type = "date";
    text.inputEl.addClass("memento-date-input");
    text.setValue(value);
    text.onChange(onChange);
    return text;
  }

  /**
   * Hour and minute boxes. Number boxes rather than a native time input,
   * whose look and 12/24-hour behaviour differ between platforms.
   */
  private addTimeInputs(
    setting: Setting,
    value: string,
    onChange: (value: string) => void,
  ): { clear: () => void } {
    let hour = "--";
    let minute = "--";
    if (value) {
      const [h, m] = value.split(":");
      hour = h ?? "--";
      minute = m ?? "--";
    }

    const emit = () => {
      if (hour === "--" && minute === "--") {
        onChange("");
      } else {
        const h = hour === "--" ? "12" : hour;
        const m = minute === "--" ? "00" : minute;
        onChange(`${h}:${m}`);
      }
    };

    const wrap = setting.controlEl.createDiv({ cls: "memento-time" });
    const part = (
      initial: string,
      placeholder: string,
      max: number,
      label: string,
      set: (v: string) => void,
    ): TextComponent => {
      const text = new TextComponent(wrap);
      text.inputEl.type = "number";
      text.inputEl.min = "0";
      text.inputEl.max = String(max);
      text.inputEl.placeholder = placeholder;
      text.inputEl.setAttribute("aria-label", label);
      text.inputEl.addClass("memento-time-part");
      text.setValue(initial !== "--" ? initial : "");
      text.onChange((raw) => {
        let val = parseInt(raw, 10);
        if (Number.isNaN(val)) {
          set("--");
        } else {
          if (val < 0) val = 0;
          if (val > max) val = max;
          const padded = val.toString().padStart(2, "0");
          set(padded);
          text.setValue(padded); // Auto-format to 2 digits
        }
        emit();
      });
      return text;
    };

    const hourInput = part(hour, "HH", 23, "Hour", (v) => {
      hour = v;
    });
    wrap.createSpan({ cls: "memento-time-separator", text: ":" });
    const minuteInput = part(minute, "MM", 59, "Minute", (v) => {
      minute = v;
    });

    return {
      clear: () => {
        hour = "--";
        minute = "--";
        hourInput.setValue("");
        minuteInput.setValue("");
        emit();
      },
    };
  }

  private handleSubmit(): void {
    if (!this.event.title?.trim()) {
      // Say which field is missing and put the cursor there.
      this.titleInput?.setAttribute("aria-invalid", "true");
      this.titleError?.removeClass("memento-is-hidden");
      this.titleInput?.focus();
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
      highPriority: this.event.highPriority || undefined,
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
