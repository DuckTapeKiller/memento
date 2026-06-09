import { Menu, WorkspaceLeaf } from "obsidian";
import type MementoPlugin from "./main";
import { getEventDatesSet } from "./types";

/**
 * CalendarDecorator observes the Calendar plugin's DOM to:
 * 1. Add border highlights to days that have events
 * 2. Add right-click context menu items to day cells
 */
export class CalendarDecorator {
  private plugin: MementoPlugin;
  private observer: MutationObserver | null = null;
  private decorationTimeoutId: number | null = null;

  private addBtnOverlay: HTMLElement | null = null;
  private currentHoverDate: string | null = null;
  private mouseMoveHandler = this.onMouseMove.bind(this);
  private contextMenuHandler = this.onContextMenu.bind(this);

  constructor(plugin: MementoPlugin) {
    this.plugin = plugin;
  }

  /**
   * Start observing the workspace for Calendar plugin views
   */
  start(): void {
    // Create the global floating add button
    this.createAddButtonOverlay();

    // Listen for layout changes to detect when calendar view appears
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => {
        this.scheduleDecoration();
      }),
    );

    // Also observe DOM changes within the calendar for month navigation
    this.setupDomObserver();

    // Track mouse to move the floating button over the calendar days
    window.addEventListener("mousemove", this.mouseMoveHandler, {
      passive: true,
    });

    // Intercept right clicks globally BEFORE Svelte handles them
    window.addEventListener("contextmenu", this.contextMenuHandler, true);

    this.plugin.register(() => {
      window.removeEventListener("mousemove", this.mouseMoveHandler);
      window.removeEventListener("contextmenu", this.contextMenuHandler, true);
      if (this.addBtnOverlay) {
        this.addBtnOverlay.remove();
        this.addBtnOverlay = null;
      }
    });

    // Initial decoration
    this.scheduleDecoration();
  }

  /**
   * Creates a single floating add button in the document body.
   */
  private createAddButtonOverlay(): void {
    if (this.addBtnOverlay) return;

    this.addBtnOverlay = activeDocument.createElement("div");
    this.addBtnOverlay.className = "memento-add-btn memento-floating-btn";
    this.addBtnOverlay.setText("+");
    this.addBtnOverlay.setAttribute("aria-label", "Create Event");
    this.addBtnOverlay.setCssStyles({ display: "none" }); // Hidden initially

    activeDocument.body.appendChild(this.addBtnOverlay);

    this.addBtnOverlay.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.currentHoverDate) {
        this.plugin.createEventForDate(this.currentHoverDate);
      }
    });
  }

  /**
   * Intercepts right clicks on calendar days globally using the capture phase.
   */
  private onContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target || !target.closest) return;

    const dayCell = target.closest(".day") as HTMLElement;
    if (dayCell && !dayCell.hasClass("adjacent-month")) {
      const leafContent =
        dayCell.closest(".workspace-leaf-content") ||
        dayCell.closest(".workspace-leaf");
      if (leafContent) {
        const dateStr = this.extractDateFromCell(
          dayCell,
          leafContent as HTMLElement,
        );
        if (dateStr) {
          // Found a valid calendar day! Stop Svelte from handling the right click.
          e.preventDefault();
          e.stopImmediatePropagation();

          const menu = new Menu();
          menu.addItem((item) => {
            item
              .setTitle("📅 Create Event")
              .setIcon("calendar-plus")
              .onClick(() => {
                this.plugin.createEventForDate(dateStr);
              });
          });

          // If there are events on this date, show them
          const eventsOnDate = this.plugin.settings.events.filter(
            (ev) => ev.date === dateStr || ev.recurrence !== "none",
          );

          if (eventsOnDate.length > 0) {
            menu.addSeparator();
            menu.addItem((item) => {
              item
                .setTitle("📋 View Events Timeline")
                .setIcon("list")
                .onClick(() => {
                  void this.plugin.activateTimelineView();
                });
            });
          }

          menu.showAtMouseEvent(e);
        }
      }
    }
  }

  /**
   * Tracks the mouse to see if we are hovering over a calendar day cell.
   */
  private onMouseMove(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target || !target.closest) return;

    // Are we over the add button itself?
    if (
      this.addBtnOverlay &&
      (target === this.addBtnOverlay || this.addBtnOverlay.contains(target))
    ) {
      return; // keep it visible
    }

    // Are we over a calendar day cell?
    const dayCell = target.closest(".day") as HTMLElement;
    if (dayCell && !dayCell.hasClass("adjacent-month")) {
      const leafContent =
        dayCell.closest(".workspace-leaf-content") ||
        dayCell.closest(".workspace-leaf");
      if (leafContent) {
        const dateStr = this.extractDateFromCell(
          dayCell,
          leafContent as HTMLElement,
        );
        if (dateStr && this.addBtnOverlay) {
          this.currentHoverDate = dateStr;
          const rect = dayCell.getBoundingClientRect();

          // Position the floating button over the cell
          this.addBtnOverlay.setCssStyles({
            display: "flex",
            top: `${rect.top + 2}px`,
            left: `${rect.left + 2}px`,
          });
          return;
        }
      }
    }

    // Otherwise, hide the button
    if (this.addBtnOverlay) {
      this.addBtnOverlay.setCssStyles({ display: "none" });
      this.currentHoverDate = null;
    }
  }

  /**
   * Schedule decoration with a small debounce to avoid excessive DOM manipulation
   */
  private scheduleDecoration(): void {
    if (this.decorationTimeoutId !== null) {
      window.clearTimeout(this.decorationTimeoutId);
    }
    this.decorationTimeoutId = window.setTimeout(() => {
      this.decorateCalendar();
      this.decorationTimeoutId = null;
    }, 100);
  }

  /**
   * Set up a MutationObserver on the workspace to detect calendar DOM changes
   */
  private setupDomObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(() => {
      this.scheduleDecoration();
    });

    // Observe the workspace container for changes
    const workspaceEl = activeDocument.querySelector(".workspace");
    if (workspaceEl) {
      this.observer.observe(workspaceEl, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false,
      });
    }

    // Clean up on unload
    this.plugin.register(() => {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    });
  }

  /**
   * Find the Calendar plugin view and decorate its day cells
   */
  private decorateCalendar(): void {
    const calendarLeaves =
      this.plugin.app.workspace.getLeavesOfType("calendar");
    if (calendarLeaves.length === 0) return;

    const eventDates = getEventDatesSet(
      this.plugin.settings.events,
      730, // 2 years lookahead for calendar highlights
    );

    for (const leaf of calendarLeaves) {
      this.decorateLeaf(leaf, eventDates);
    }
  }

  /**
   * Decorate a single calendar leaf's day cells.
   * Only sets up the border highlighting now, as the Add button is handled globally.
   */
  private decorateLeaf(leaf: WorkspaceLeaf, eventDates: Set<string>): void {
    const container = leaf.view.containerEl;
    if (!container) return;

    // The calendar plugin renders day cells with class "day"
    const dayCells = container.querySelectorAll(".day");

    for (const cell of Array.from(dayCells)) {
      const dayEl = cell as HTMLElement;

      // Try to extract the date from the day cell
      const dateStr = this.extractDateFromCell(dayEl, container);
      if (!dateStr) continue;

      // Add or remove the border highlight class
      if (eventDates.has(dateStr)) {
        dayEl.addClass("has-memento-event");
      } else {
        dayEl.removeClass("has-memento-event");
      }
    }
  }

  /**
   * Extract the date string from a calendar day cell.
   * The calendar renders a grid, and we extract the month/year robustly from the container's text.
   */
  private extractDateFromCell(
    cell: HTMLElement,
    container: HTMLElement,
  ): string | null {
    // Get the day number from the cell
    const dayText = cell.textContent?.trim();
    if (!dayText) return null;
    const dayNum = parseInt(dayText, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) return null;

    let month = new Date().getMonth() + 1;
    let year = new Date().getFullYear();

    // The Svelte Calendar explicitly renders the month and year inside these classes
    const monthEl = container.querySelector(".title .month");
    const yearEl = container.querySelector(".title .year");

    if (monthEl && yearEl) {
      const mText = monthEl.textContent?.trim() || "";
      const yText = yearEl.textContent?.trim() || "";

      const parsedY = parseInt(yText, 10);
      if (!isNaN(parsedY)) {
        year = parsedY;
      }

      const mNum = this.getMonthNumber(mText);
      if (mNum > 0) {
        month = mNum;
      }
    } else {
      // Fallback parsing if Svelte DOM structure changes entirely
      const containerText = container.innerText || container.textContent || "";
      const parsedMonthYear = this.parseMonthYearRobust(containerText);
      if (parsedMonthYear) {
        month = parsedMonthYear.month;
        year = parsedMonthYear.year;
      }
    }

    // Handle days that belong to previous/next month
    const isAdjacentMonth =
      cell.hasClass("adjacent-month") ||
      cell.hasClass("previous-month") ||
      cell.hasClass("next-month");

    if (isAdjacentMonth) {
      if (dayNum > 20) {
        month -= 1;
        if (month < 1) {
          month = 12;
          year -= 1;
        }
      } else {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }

    return `${year}-${month.toString().padStart(2, "0")}-${dayNum.toString().padStart(2, "0")}`;
  }

  private getMonthNumber(monthStr: string): number {
    if (!monthStr) return 0;
    const clean = monthStr.replace(/\./g, "").trim().toLowerCase();

    const monthNamesEn = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const monthNamesEs = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];
    const monthNamesShortEn = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthNamesShortEs = [
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];

    let m = monthNamesEn.indexOf(clean) + 1;
    if (m === 0) m = monthNamesEs.indexOf(clean) + 1;
    if (m === 0) m = monthNamesShortEn.indexOf(clean) + 1;
    if (m === 0) m = monthNamesShortEs.indexOf(clean) + 1;

    if (m > 0) return m;

    // Use Obsidian's bundled Moment.js to parse the exact locale string Svelte output
    if (window.moment) {
      const parsed = window.moment(clean, ["MMM", "MMMM"], true);
      if (parsed.isValid()) return parsed.month() + 1;

      const parsedLoose = window.moment(clean, ["MMM", "MMMM"]);
      if (parsedLoose.isValid()) return parsedLoose.month() + 1;
    }

    return 0;
  }

  private parseMonthYearRobust(
    text: string,
  ): { month: number; year: number } | null {
    const cleanText = text
      .toLowerCase()
      .replace(/[,.]/g, " ")
      .replace(/\s+/g, " ");

    const monthNamesEn = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const monthNamesEs = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];
    const monthNamesShortEn = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const monthNamesShortEs = [
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];
    const allMonths = [
      ...monthNamesEn,
      ...monthNamesEs,
      ...monthNamesShortEn,
      ...monthNamesShortEs,
    ];

    for (const m of allMonths) {
      const regex1 = new RegExp(`\\b${m}\\s+(?:de\\s+)?(20\\d\\d)\\b`);
      const match1 = cleanText.match(regex1);
      if (match1)
        return { month: this.getMonthNumber(m), year: parseInt(match1[1], 10) };

      const regex2 = new RegExp(`\\b(20\\d\\d)\\s+(?:de\\s+)?${m}\\b`);
      const match2 = cleanText.match(regex2);
      if (match2)
        return { month: this.getMonthNumber(m), year: parseInt(match2[1], 10) };
    }

    const numMatch1 = cleanText.match(/\b(20\d\d)[-/ ](\d{1,2})\b/);
    if (numMatch1) {
      const m = parseInt(numMatch1[2], 10);
      if (m >= 1 && m <= 12)
        return { month: m, year: parseInt(numMatch1[1], 10) };
    }
    const numMatch2 = cleanText.match(/\b(\d{1,2})[-/ ](20\d\d)\b/);
    if (numMatch2) {
      const m = parseInt(numMatch2[1], 10);
      if (m >= 1 && m <= 12)
        return { month: m, year: parseInt(numMatch2[2], 10) };
    }

    return null;
  }

  /**
   * Handle right-click on a day cell
   */
  private onDayContextMenu(e: MouseEvent, dateStr: string): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle("📅 Create Event")
        .setIcon("calendar-plus")
        .onClick(() => {
          this.plugin.createEventForDate(dateStr);
        });
    });

    // If there are events on this date, show them
    const eventsOnDate = this.plugin.settings.events.filter(
      (ev) => ev.date === dateStr || ev.recurrence !== "none",
    );

    if (eventsOnDate.length > 0) {
      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle("📋 View Events")
          .setIcon("list")
          .onClick(() => {
            void this.plugin.activateTimelineView();
          });
      });
    }

    menu.showAtMouseEvent(e);
  }

  /**
   * Force refresh decorations (called after event changes)
   */
  refresh(): void {
    this.scheduleDecoration();
  }

  /**
   * Clean up
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.decorationTimeoutId !== null) {
      window.clearTimeout(this.decorationTimeoutId);
    }

    // Remove all decoration classes
    const cells = activeDocument.querySelectorAll(".has-memento-event");
    cells.forEach((cell) => cell.removeClass("has-memento-event"));
  }
}
