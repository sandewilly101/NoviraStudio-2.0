# Novira Studio

AI-powered 3D event mockups. Upload a venue model, describe the event, and get
three layout options. Then edit everything in 3D and render images, 360° views,
walkthrough videos and floor plans. Clients review and approve the design through a link.

```
novira-studio/
  server/   Node.js + Express API, MySQL (MariaDB), AI planner + layout solver
  app/      Expo (React Native) app: runs in the browser on a laptop; 3D with three.js / React Three Fiber
```

## How it works

1. **Venue.** Upload a `.glb`/`.gltf`. The app measures it in the browser
   (units, room size, height) and saves the usable floor rectangle. You can
   narrow that rectangle on the venue page (for example, to just the ballroom).
2. **Brief → plan.** GPT-4o turns the brief into a structured plan: layout,
   guests, colours, must-haves. Without an OpenAI key, a built-in rule-based
   planner is used.
3. **Plan → layout.** A deterministic solver (`server/src/ai/layout.js`)
   places the stage, LED wall, bar, dance floor, tables and every chair. It keeps
   walkways and wall clearance and reports checks in plain words. The AI decides
   *what* to place and the solver decides *where*, so layouts are always physically valid.
4. **Edit.** Select / move / rotate / resize, set materials, colours and sizes,
   and add text or AI graphics to the LED wall and signs. You can add objects from
   the library or from Sketchfab, and edit by chat ("make the stage 2 m wider"),
   with undo/redo and versions.
5. **Render (in the browser, no GPU servers).** Snapshot, **photoreal preview
   with Nano Banana**, 360° panorama, 14-second walkthrough video (WebM) and a
   top-down floor plan.
6. **Share.** A public link where clients orbit the 3D scene, pin comments to
   spots in the room and approve the latest version.

## Requirements

- Node.js 20+
- MySQL or MariaDB (XAMPP works). The API creates the `novira_studio` database and tables itself.
- Chrome or Edge for the app (WebGL).

## Run it

```bash
# 1. API
cd server
cp .env.example .env        # then fill in the keys you have (see below)
npm install
npm run seed                # demo user + the Rotana venue (SEED_VENUE_PATH)
npm start                   # http://localhost:4150

# 2. App (new terminal)
cd app
npm install
npx expo start --web        # http://localhost:8081
```

Demo login: `demo@novira.studio` / `novira-demo`

The app reads the API address from `app/.env` (`EXPO_PUBLIC_API_URL`).

## Keys (`server/.env`)

| Key | Used for | Without it |
|---|---|---|
| `OPENAI_API_KEY` (`OPENAI_MODEL=gpt-4o`) | Brief → plan, chat edits | Built-in rules (handles common requests) |
| `GEMINI_API_KEY` (`GEMINI_IMAGE_MODEL=gemini-2.5-flash-image`, "Nano Banana") | Photoreal previews, AI graphics | Snapshot is saved instead; AI graphics disabled |
| `NANOBANANA_API_KEY` + `CLOUDINARY_*` | Nano Banana via nanobnana.com (Cloudinary hosts frames so it can read them) | Falls back to `GEMINI_API_KEY` if set |
| `SKETCHFAB_API_TOKEN` | Importing Sketchfab models | Search still works; import is disabled |
| — | **BlenderKit** and **Poly Haven** models | Work without any key (free assets only) |

Keys stay on the server and are never sent to the browser. Restart the API after changing them.

## Tests

```bash
cd server && npm test       # layout solver + rule planner
cd app && npx tsc --noEmit && npx eslint src
```

## Notes and limits

- Very detailed venue files (like the 1.5 M-triangle Rotana model) load slowly
  on older laptops. Simplifying the model (for example with `gltf-transform`) helps.
- If the venue file is a whole building, set the usable floor on the venue page
  so furniture stays inside the event room.
- Phone and tablet builds open, but the 3D editor currently runs on the web;
  the native renderer (expo-gl) is a next step.
- Blender-based final renders are planned for a later phase.
