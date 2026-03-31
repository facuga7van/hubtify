# Hubtify

Gamified life hub — quests, nutrition, and finance in one RPG app.

## Download

**[Download latest version](https://github.com/facuga7van/hubtify/releases/latest)**

> Windows only. Download the `Hubtify-X.X.X.Setup.exe` file from the latest release.

## Features

### Questify
- Task management with tiers (Quick / Normal / Epic)
- Subtasks, projects, categories
- Habit tracker with daily/weekly/monthly frequency and streaks
- Drag-and-drop reordering
- RPG-styled XP, combos, and level progression

### Nutrify
- AI-powered calorie estimation (local model, runs offline)
- Food logging with daily/weekly tracking
- TDEE calculation with dynamic activity factor
- Weekly weight check-in with progress tracking
- Day close system with XP rewards
- Auto-installs AI engine on first use

### Coinify
- Income and expense tracking
- Loan management
- Category breakdown
- Monthly balance

### RPG System
- XP and leveling across all modules
- HP system with penalties
- Daily combo multipliers
- Streak bonuses and milestones
- Character customization

## Development

```bash
npm install
npm run rebuild
npm start
```

## Build

```bash
npm run make
```

Generates installer in `out/make/squirrel.windows/x64/`.

## Release

Push a version tag to trigger automated build and release:

```bash
# Update version in package.json and forge.config.ts
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds the installer and creates a release automatically.

## Tech Stack

- Electron + React + TypeScript
- SQLite (better-sqlite3) for local storage
- Firebase Firestore for sync and food telemetry
- Gemini API for calorie estimation
- Vite for bundling
- Electron Forge for packaging
