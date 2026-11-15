# ISL ASTRO-NOTS

The ISL ASTRO-NOTS project is an agricultural intelligence dashboard built for the NASA Space Apps hackathon. Users can select a farm location and view NASA POWER environmental data, including temperature, rainfall, humidity, growing degree days, soil information, and crop-cycle context.

The project also includes a FastAPI service that retrieves NASA data and stores the latest weather observation in Supabase. A local LoRa bridge can send that weather data to the connected Heltec/LoRa hardware.

## Project structure

```text
dashboard/
├── src/                 React dashboard and FastAPI source files
├── public/              Static assets and logo
├── bash/                Local setup and run scripts
├── package.json         Frontend dependencies and scripts
└── src/requirements.txt Python dependencies for the API and LoRa tools
```

## Requirements

- Node.js and npm
- Python 3
- Internet access for NASA POWER and Microsoft Planetary Computer data
- Optional: Supabase project credentials
- Optional: Heltec/LoRa hardware and a USB serial connection

## Run locally

From the repository root, run:

```bash
./dashboard/bash/run.sh
```

The first run automatically creates `dashboard/.venv`, installs the Python packages from `dashboard/src/requirements.txt`, and installs the npm packages. It then starts:

- React/Vite dashboard: http://localhost:5174
- FastAPI service: http://localhost:8000

Press `Ctrl+C` once to stop the frontend and the FastAPI process started by the script.

To install dependencies without starting the servers:

```bash
./dashboard/bash/setup.sh
```

## Environment variables

Create `dashboard/.env` for the Python service and copy in the values you need:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-server-only-secret-key
FRONTEND_URL=http://localhost:5174
```

For the React Supabase authentication client, add these Vite variables to the environment used to build the dashboard:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Authentication is optional. Users can use the dashboard without creating an account.

## API endpoints

The FastAPI service exposes:

- `GET /api/weather` — NASA POWER weather and growing degree day data
- `GET /api/ndvi` — Landsat NDVI data through Microsoft Planetary Computer
- `GET /api/lora/status` — local LoRa bridge status
- `POST /api/lora/send` — queue the latest weather packet for the LoRa bridge

The LoRa endpoints are intended for local hardware use. Do not expose the unauthenticated LoRa write endpoint to the public internet without adding authentication.

## Development notes

The Vite development server proxies `/api` requests to FastAPI on port `8000`. The Python API and the LoRa bridge are separate from the React frontend; the bridge must run on the computer connected to the LoRa hardware.
