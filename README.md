# Memento

[![GitHub Repository](https://img.shields.io/badge/GitHub-DuckTapeKiller%2Fmemento-blue?logo=github)](https://github.com/DuckTapeKiller/memento)

**Memento** is a powerful event and timeline management plugin for Obsidian. It seamlessly integrates with the popular Obsidian Calendar plugin to track, manage, and visualize your upcoming events in a beautiful interactive timeline.

## Features

- **📅 Calendar Integration**: Events are automatically highlighted on your Obsidian Calendar. Right-click any day on the calendar to instantly schedule a new event.
- **🌐 External Calendar Absorption**: Add read-only ICS subscriptions from Google Calendar, iCloud, or any calendar that exposes an `.ics` URL. External events are cached separately from editable Memento events.
- **⏳ Interactive Timeline View**: A dedicated sidebar view that merges Memento and external events chronologically, with search, source, calendar, date range, completed, and archived filters.
- **🔁 Recurring Events**: Supports Daily, Weekly, Monthly, and Yearly events with custom intervals, optional end dates, and occurrence counts.
- **📝 Automated Event Notes**: Click any event in the timeline to create or open a dedicated note. Memento remembers note paths per occurrence and refreshes note frontmatter when opened again.
- **✅ Event Workflows**: Edit, duplicate, complete, archive, delete, copy, hide external events, or import an external event as an editable Memento event.
- **📦 Import and Export**: Export manual events to JSON and import Memento JSON backups from the settings tab.
- **🌍 Localization**: Fully supports both English and Spanish formatting out of the box, including translating the frontmatter keys (Title/Título, Date/Fecha, Context/Contexto) and flawlessly parsing localized calendar dates.

## How to Use

1. **Creating an Event**: 
   - Right-click any date inside the standard Obsidian Calendar view.
   - Or, open the Memento Timeline view and click the floating **+** button in the bottom right corner.
2. **Managing the Timeline**: 
   - Open the command palette (`Ctrl/Cmd + P`) and search for **Memento: Open Timeline View** to open the timeline in the sidebar.
   - Use the controls at the top of the timeline to search, filter by source/calendar, and include completed or archived events.
3. **Managing Events and Notes**: 
   - Click on an event card inside the timeline to edit, duplicate, complete, archive, copy, import, hide, or open/create a note for that specific occurrence. New notes include the event's details saved cleanly in YAML properties.
4. **Deleting Events**: 
   - Hover over an event in the timeline and click the trash icon. A native warning modal will ask for confirmation before permanently deleting it.
5. **Absorbing External Calendars**:
   - Open Memento settings, add an ICS calendar name and URL, then click **Refresh now**. Google Calendar private ICS URLs and shared iCloud calendar ICS URLs are the intended first sync path.

## Settings

Memento provides flexible configuration options inside the plugin settings tab:
- **Timeline View Mode**: Choose whether the timeline should list all upcoming events indefinitely, or restrict the view to only show events for the current month.
- **Show Past Events**: Toggle whether one-time events that have already expired should be visible in the settings management list.
- **Event Notes Folder**: Specify an exact folder path where event notes should be generated. Leave blank to generate them in the vault root.
- **Frontmatter Language**: Choose whether the generated YAML properties use English (`Title`, `Date`, `Context`) or Spanish (`Título`, `Fecha`, `Contexto`).
- **External Calendars**: Add, enable, disable, refresh, or remove read-only ICS calendar subscriptions.
- **Data Management**: Export manual events to JSON or import events from a previous Memento JSON export.

## Manual Installation

1. Go to the **Releases** page of this repository.
2. Download the latest `main.js`, `manifest.json`, and `styles.css` files.
3. Create a folder named `memento` inside your vault's `.obsidian/plugins/` directory.
4. Place the three downloaded files inside that folder.
5. Reload Obsidian and enable **Memento** in your Community Plugins settings.

*(Note for developers: Simply push a new release tag to GitHub and the included GitHub Actions workflow will automatically lint, format, build, and publish the release assets for you.)*
