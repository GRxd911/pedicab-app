# Pedicab Support System

## Project Structure (Reorganized)

This project has been reorganized into role-based directories and shared resources.

### Role-Based Modules
- **commuter/**: Passenger-facing application (Request a ride, track driver).
  - `signin.html`, `signup.html`, `app.html` (Main App)
  - `js/`: Commuter-specific logic (`controller.js`, services).
- **driver/**: Driver-facing application (Receiver requests, navigation, earnings).
  - `signin.html`, `signup.html` (Redirects/Copies), `app.html` (Main App)
  - `js/`: Driver-specific logic.
- **tmo/**: Traffic Management Office (Admin) Dashboard.
  - `signin.html`, `dashboard.html` (Main Dashboard)
  - `js/`: Admin logic.

### Shared Resources
- **shared/**: Common assets and utilities used across all modules.
  - `css/`: `style.css` (Main stylesheet).
  - `js/`:
    - `config/`: Supabase configuration.
    - `services/`: common services (audio, location, ride logic).
    - `utils/`: UI and Map utilities.
  - `assets/`: Images and Icons (`logo.jpg`, `logo.svg`, etc).

### Other Directories
- **public/**: Public landing pages (`index.html`, `terms.html`, `logo-creator.html`).
- **database/**: SQL scripts for database setup and maintenance.
- **docs/**: Documentation files.

## Running the Project
Open `public/index.html` or `commuter/signin.html` to start the application.
Ensure `manifest.json` and `sw.js` are in the root for PWA functionality.
