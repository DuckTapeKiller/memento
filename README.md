# Memento

[![GitHub Repository](https://img.shields.io/badge/GitHub-DuckTapeKiller%2Fmemento-blue?logo=github)](https://github.com/DuckTapeKiller/memento)

**Memento** is a powerful event and timeline management plugin for Obsidian. It seamlessly integrates with the popular Obsidian Calendar plugin to track, manage, and visualize your upcoming events in a beautiful interactive timeline.

## Features

- **📅 Calendar Integration**: Events are automatically highlighted on your Obsidian Calendar. Right-click any day on the calendar to instantly schedule a new event.
- **⏳ Interactive Timeline View**: A sleek, dedicated sidebar view that displays your upcoming events chronologically. You can filter the timeline to show events for just the current month or all future upcoming events.
- **🔁 Recurring Events**: Full support for recurring schedules, including Daily, Weekly, Monthly, and Yearly events.
- **📝 Automated Event Notes**: Click on any event in the timeline to instantly generate a dedicated note for it. Memento will automatically scaffold the note and inject a rich YAML frontmatter block containing the event's Title, Date, Time, and Context.
- **🌍 Localization**: Fully supports both English and Spanish formatting out of the box, including translating the frontmatter keys (Title/Título, Date/Fecha, Context/Contexto) and flawlessly parsing localized calendar dates.

## How to Use

1. **Creating an Event**: 
   - Right-click any date inside the standard Obsidian Calendar view.
   - Or, open the Memento Timeline view and click the floating **+** button in the bottom right corner.
2. **Managing the Timeline**: 
   - Open the command palette (`Ctrl/Cmd + P`) and search for **Memento: Open Timeline View** to open the timeline in the sidebar.
3. **Generating Notes**: 
   - Simply click on an event card inside the timeline. Memento will ask if you want to generate a note for that specific occurrence. If accepted, it creates a note with the event's details saved cleanly in YAML properties.
4. **Deleting Events**: 
   - Hover over an event in the timeline and click the trash icon. A native warning modal will ask for confirmation before permanently deleting it.

## Settings

Memento provides flexible configuration options inside the plugin settings tab:
- **Timeline View Mode**: Choose whether the timeline should list all upcoming events indefinitely, or restrict the view to only show events for the current month.
- **Show Past Events**: Toggle whether one-time events that have already expired should be visible in the settings management list.
- **Event Notes Folder**: Specify an exact folder path where event notes should be generated. Leave blank to generate them in the vault root.
- **Frontmatter Language**: Choose whether the generated YAML properties use English (`Title`, `Date`, `Context`) or Spanish (`Título`, `Fecha`, `Contexto`).

## Manual Installation

1. Go to the **Releases** page of this repository.
2. Download the latest `main.js`, `manifest.json`, and `styles.css` files.
3. Create a folder named `memento` inside your vault's `.obsidian/plugins/` directory.
4. Place the three downloaded files inside that folder.
5. Reload Obsidian and enable **Memento** in your Community Plugins settings.

*(Note for developers: Simply push a new release tag to GitHub and the included GitHub Actions workflow will automatically lint, format, build, and publish the release assets for you.)*
