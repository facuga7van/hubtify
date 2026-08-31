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
- AI-powered calorie estimation via the Gemini API, called through a Firebase
  Cloud Function (`estimateNutrition`) — **requires an internet connection**
- Food logging with daily/weekly tracking
- TDEE calculation with dynamic activity factor
- Weekly weight check-in with progress tracking
- Day close system with XP rewards

### Coinify
- Income and expense tracking
- Credit cards and installments
- Recurring transactions
- Loan management
- Bank/card statement import (PDF)
- Category breakdown and monthly balance

### Cauldron
- Pomodoro timer with configurable presets
- Floating always-on-top timer
- Session stats and XP rewards

### RPG System
- XP and leveling across all modules
- HP system with penalties
- Daily combo multipliers
- Streak bonuses and milestones
- Character customization (PixiJS avatar)

### Hub
- Multi-account with Firebase Firestore sync
- Desktop notifications and reminders
- Spanish / English (i18n)
- In-app changelog, onboarding tour, and feedback reporting

## Development

```bash
npm install
npm run rebuild   # compiles better-sqlite3 against the Electron ABI
npm start
```

Checks (all three run in CI on every push/PR to `master`):

```bash
npx tsc --noEmit   # typecheck
npm test           # Vitest, runs under Electron
npm run lint       # ESLint (react-hooks rules are errors)
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
- Firebase Cloud Functions + Gemini API for calorie estimation
- PixiJS for the character avatar, GSAP for animation
- Vite for bundling
- Electron Forge for packaging
