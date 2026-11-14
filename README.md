# BrandLens — AI Brand Governance MVP

**Tagline:** Check Before You Publish.

BrandLens helps organisations check marketing content against saved brand guidelines before publishing. It analyses tone consistency, prohibited terminology, preferred phrases, approved factual claims, and general writing rules, explains every finding, suggests a grounded rewrite, and enforces human-in-the-loop review and approval persisted in SQLite.

---

## Key Features

- **Brand Guideline Management**: Configure brand description, preferred tone, preferred terms, prohibited terms, approved facts, and general writing guidelines in SQLite. Includes the preloaded **NovaWear** sample brand.
- **Content Checker**: Submit social media posts, advertisements, product descriptions, or general text, with one-click Non-Compliant and Compliant NovaWear sample presets.
- **Explainable AI Analysis & Demo Mode**: Uses Google Gemini (`gemini-4-hydrogen`) via server-side API endpoints to return validated structured JSON findings tied directly to supplied guidelines. Automatically provides a clearly labelled **Demo Mode** rule-based analyser when `GEMINI_API_KEY` is unavailable.
- **Side-by-Side Comparison & Manual Editing**: Word-level diff highlighting between original and suggested content, with controls to Accept, Reject, or manually edit corrections.
- **Human Review & Approval Gate**: Dedicated approval workflow (`Approve Original`, `Approve Corrected`, `Reject Content`, `Save Final Approved Version`) stored in SQLite. AI never auto-approves or publishes content.
- **Analysis History**: Searchable, filterable audit log of all past checks and review decisions.

---

## Project Structure

```text
BrandLens/
├── src/                      # React + TypeScript + Tailwind CSS frontend
│   ├── components/           # Layout & semantic status components
│   ├── pages/                # Dashboard, Guidelines, Checker, Results, Review, History
│   ├── services/api.ts       # Fetch API client
│   ├── utils/diff.ts         # Word-level diff helper
│   ├── types.ts              # Shared TypeScript interfaces
│   └── App.tsx               # Application router & state orchestration
├── server/                   # Node.js Express runtime (used on port 3000)
│   ├── db.ts                 # SQLite schema & NovaWear seed (node:sqlite)
│   └── analyzer.ts           # Gemini API + Demo Mode analyser
├── server.ts                 # Express + Vite middleware full-stack server
├── backend/                  # Standalone Python + FastAPI backend
│   ├── main.py               # FastAPI app & health check
│   ├── database.py           # SQLite schema & NovaWear seed (sqlite3)
│   ├── models.py             # Pydantic request validation models
│   ├── routes/               # /api/brands, /api/analyze, /api/history, /api/review
│   ├── services/             # Gemini & Demo Mode analyser (google-genai)
│   ├── requirements.txt
│   └── .env.example
├── .env.example
└── README.md
```

---

## Running Locally on Windows PowerShell

You can run the integrated full-stack server directly (`npm run dev`), or run the **React + Vite frontend** and **Python + FastAPI backend** in two separate PowerShell terminals.

### Option A: Separate Frontend (Vite) + Backend (Python FastAPI) on Windows PowerShell

#### Terminal 1 — Start the Python FastAPI Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Optional: edit backend\.env and set GEMINI_API_KEY="your-key" (leave as-is for Demo Mode)
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Verify backend health in PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

#### Terminal 2 — Start the React + Vite Frontend

From the project root:
```powershell
npm install
$env:VITE_API_URL = "http://127.0.0.1:8000"
npx vite --port 5173
```

Open `http://localhost:5173` in your browser.

---

### Option B: Integrated Node.js + Vite Full-Stack Server (Port 3000)

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:3000` in your browser.

---

## API Endpoints

- `GET /api/health` — Backend status, SQLite connectivity, and active AI mode (`gemini` or `demo`)
- `GET /api/brands` — List all brand profiles
- `POST /api/brands` — Create a new brand profile
- `GET /api/brands/{id}` — Retrieve brand guidelines
- `PUT /api/brands/{id}` — Update brand guidelines
- `POST /api/analyze` — Analyse submitted content against brand guidelines
- `GET /api/history` — Retrieve analysis history and database summary counts
- `GET /api/history/{id}` — Retrieve a single analysis with issues and brand details
- `POST /api/review/{id}` — Save human approval/rejection decision and final content

---

## Testing the End-to-End Workflow

1. Open BrandLens and confirm **NovaWear** is selected.
2. Open **Brand Guidelines** to inspect or edit NovaWear's tone, preferred terms, prohibited terms, approved facts, and general guidelines, then click **Save Guidelines**.
3. Open **Content Checker**, click **Load Non-Compliant Sample**, and click **Analyse Content**.
4. Inspect the **Analysis Results**: verify prohibited terms (`cheapest`, `100% risk-free`, `guaranteed`), exaggerated claims, and tone issues are flagged with explanations and rule references.
5. Compare Original vs. Suggested Correction side-by-side; test **Edit Manually**, **Accept Correction**, or **Reject Correction**.
6. Click **Proceed to Review & Approval**, choose **Approve Corrected** (or **Approve Original** / **Reject Content**), and click **Save Final Approved Version**.
7. Open **Analysis History** and refresh the page to verify all records and decisions persist in SQLite (`brandlens.db`).
8. Return to **Content Checker** and click **Load Compliant Sample** to verify compliant content passes with zero violations.
