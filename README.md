# DataFix – Autonomous Data Quality & Repair Engine

One folder, one repo: **React (Vite)** UI + **Node serverless functions** (`/api`) + optional **Supabase** + **Android (Java)** WebView wrapper. Deploys to **Vercel**.

```
datafix/
├─ src/                React UI (Voice-Mail look & feel)
│  └─ engine/          the data-quality engine (pure JS, runs in the browser, unit-tested)
├─ api/                Vercel functions: health, insights (Groq), save (Supabase)
├─ public/sample/      deliberately dirty demo CSV
├─ supabase/schema.sql optional run-history table
├─ android/            Android Studio project (Java WebView)
├─ test/               engine tests (ground-truth benchmark)
└─ vercel.json · vite.config.js · package.json
```

## 1. Run locally
```bash
npm install
cp .env.example .env      # then paste your own keys (see below)
npm run dev               # http://localhost:5173  (UI and /api work together)
npm test                  # engine benchmark vs injected faults
```
Requires Node 18+. **Rotate your Groq key** (it was shared in plain text) at console.groq.com and put the new one in `.env` – never in code or git.

## 2. Supabase (optional)
Create a project → SQL editor → run `supabase/schema.sql`. Put `SUPABASE_URL` and the **service_role** key in `.env`. Skip this and the app still works (history just disabled).

## 3. Deploy: GitHub → Vercel
```bash
git init && git add . && git commit -m "DataFix"
git branch -M main && git remote add origin https://github.com/<you>/datafix.git && git push -u origin main
```
vercel.com → *Add New Project* → import the repo (auto-detects Vite). Under *Environment Variables* add `GROQ_API_KEY`, `GROQ_MODEL` (optional), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` → Deploy. Your site: `https://<project>.vercel.app`.

## 4. Android app
1. Open the **`android/`** folder in Android Studio (let it sync / download Gradle).
2. In `android/app/build.gradle` set `APP_URL` to your Vercel URL (emulator + local dev: `http://10.0.2.2:5173`).
3. Run ▶ on a device/emulator, or *Build → Build APK(s)*.
File picking and downloads (cleaned CSV, logs) work through native bridges in `MainActivity.java` – saved files land in **Downloads**.

## How it works
**Detect** (`detect.js`): missing & placeholders, exact/near duplicates (hash, sorted-neighbourhood, MinHash-LSH, Fellegi–Sunter, Jaro-Winkler/Damerau), invalid email/phone/URL/date, type & schema errors, inconsistent categories/dates/phones/booleans (BK-tree, Soundex, case folding), noise (whitespace, markup, mojibake, Unicode), outliers (Z, Modified-Z, IQR, MAD, Grubbs; ≥2 votes) + multivariate anomalies (Isolation Forest), integrity (ranges, keys, date order, functional dependencies). Each finding carries **row, column #, spreadsheet cell, value, message, likely cause, detector**.

**Diagnose**: missingness pattern (random vs dependent on another column vs co-missing columns), duplicate origin, format-mixing, etc.

**Repair** (`repair.js`, `impute.js`): noise → standardization → FD lookup → entity resolution/merge → domain fixes & winsorizing (only when ≥4 detectors agree) → imputation. Imputation is *autonomous*: Mean/Median/Mode/KNN/Hot-deck/Regression/MICE/Interpolation are **back-tested on held-out known cells** and the best per column wins. Anything below the confidence slider is *proposed, not applied*; fields that cannot be inferred (IDs, e-mails, names) are left alone and reported.

**Validate**: full re-detection, cell-level **confusion matrix** (TP = dirty & fixed, FN = unresolved, FP = clean cells changed, TN), precision/recall/F1, residual issues.

**Quality dimensions** (0–100): Completeness = 1 − empty cells/all cells · Uniqueness = 1 − duplicate rows/rows · Validity = 1 − (type+format-invalid cells)/non-empty cells · Consistency = 1 − (inconsistent+noisy cells)/non-empty · Accuracy = 1 − (outlier/anomaly/rule-violating cells)/non-empty · Timeliness = 1 − (impossible, future or ancient dates)/date cells. *Clean records* = % of rows with no finding at all.

## Algorithm coverage (honest list)
`src/engine/registry.js` lists all 65 techniques from the brief with status. **Implemented & used:** Mean/Median/Mode/KNN/MICE/Regression/Hot-Deck/Interpolation imputation; Hash, sorting-based, fingerprint, record-linkage, entity-resolution, Fellegi–Sunter, Damerau–Levenshtein, Jaro-Winkler, MinHash, LSH, BK-tree; Z, Modified-Z, IQR, MAD, Grubbs, Isolation Forest; rule-based normalization, canonicalization, regex, dictionary & lookup mapping, Unicode normalization, case folding, Soundex. **In the code library but not auto-selected:** Levenshtein, Jaro, cosine, SimHash. **Not implemented (roadmap):** MissForest, Bayesian, EM, SoftImpute, Kalman, Autoencoder/GAIN imputation; DBSCAN/hierarchical/OPTICS; Dixon's Q, Mahalanobis, LOF, KNN-outlier, EIF, One-Class SVM, Elliptic Envelope, Robust PCA, VAE, Deep SVDD, CUSUM; Metaphone/Double Metaphone.

## Limits
Runs in the browser (data never leaves the device; only aggregate stats go to Groq). Comfortable up to ~50k rows. Excel (.xlsx) is not parsed – export to CSV first.

## 5. Added Enterprise Intelligence features
- **Contextual diagnosis**: issue pattern cards with evidence/cause details from the engine's existing diagnosis output.
- **Repair All / Review Changes / Undo All**: Repair runs the engine, review previews the repair log, Undo clears the repaired result and returns to the untouched analyzed dataset.
- **Data Quality Time Machine**: after repair, use the Time Machine sidebar entry to browse original, duplicate-cleaned, missing-value, outlier, and final snapshots.
- **Data Quality Score branding**: score banners on diagnosis and result screens.
- **Repair Confidence Meter**: confidence values for applied repairs; low-confidence skipped items remain noted.
- **Blast Radius estimates**: issue-count based exposure indicators with downstream risk caveat.
- **Self-Healing Pipeline**: opt in from the sidebar. It saves the current schema signature in browser storage and automatically reruns repair on a later upload matching the column structure. Advanced policy targets are shown, but *not all are enforced* by this demo engine.
- **Forensic Word-compatible audit**: Export → Quality reports → Download Word forensic report. This is Word-openable HTML with a `.doc` extension (not a native OOXML `.docx` yet) and includes 15 audit sections, issue tables, column profile, and repair log.
- **KDD Learning History**: Supabase stores schema-matched aggregate issue patterns, algorithm confidence counts, and score deltas. After two matching observations, prior score deltas influence repair confidence thresholds. This is an adaptive heuristic, not supervised model training. Raw dataset rows are not sent to the learning table.

## 6. Supabase setup for history + KDD
1. Supabase project → SQL Editor.
2. Run the current `supabase/schema.sql` (creates `datafix_runs` and `datafix_learning`).
3. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on local `.env` or Vercel. Keep the service-role key server-only; never expose it in Vite client variables. The key may be named `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
4. After a repair, DataFix automatically saves the run summary and aggregate knowledge when Supabase is detected. Export → Supabase history remains available for manual save/list. Sidebar → **KDD Learning** displays stored knowledge records.
5. Redeploy/restart after environment variables or SQL changes.


## 7. Where to find the new features
- **Quality Report**: contextual diagnosis cards, Data Quality score, Blast Radius estimates, Repair All / Review Changes / Undo All.
- **Results Report**: post-repair score, confidence meter and before/after metrics.
- **Time Machine**: stage selector for original, duplicate-cleaned, missing-value-filled, outlier-fixed and final views.
- **Self-Healing**: enable reusable schema pipeline; future uploads with matching columns can trigger the repair automatically.
- **KDD Learning**: inspect aggregate learning records stored in Supabase.
- **Export → Quality reports**: Download Word forensic report (Word-compatible `.doc`), report JSON, print/PDF.

### Windows PowerShell startup
```powershell
cd path\to\datafix
npm install
Copy-Item .env.example .env
# Edit .env and add your keys (optional)
npm run dev
```
Then open the local Vite URL printed in the terminal (normally `http://localhost:5173`).


### Supabase persistence and KDD feedback (updated)

- Run history is saved to `datafix_runs`; aggregate KDD observations are saved to `datafix_learning`.
- Server responses now distinguish run-history success from learning-table success; failures are shown in the app instead of being silently swallowed.
- KDD fetches prior observations with the same schema fingerprint. After at least two matching observations, the repair engine uses historical overall quality-score delta as a proxy to modestly adjust per-algorithm confidence thresholds. Positive historical deltas lower the threshold by 2.5 percentage points; negative deltas raise it by 5 points. This is a transparent feedback heuristic, **not a trained ML model**, because score deltas are not ground-truth labels for individual repairs.
- Keep `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` only in server-side `.env`; do not expose either in frontend code.

## 8. DataFix AI Agent (Knowledge Chat + Voice Dataset Agent)
- Sidebar → **DataFix AI Agent** opens a conversational assistant.
- The chat endpoint retrieves recent aggregate KDD records from Supabase and passes them as evidence to Groq. It is instructed to separate historical evidence from general advice and never fabricate learning.
- Toggle **Voice On** to hear assistant responses. Use the microphone button to dictate questions (Chrome/Edge support varies; microphone permission is required and local development on `localhost` is treated as a secure origin).
- The **Voice Dataset Agent** lets you upload CSV, TSV, JSON, NDJSON, or XML. It runs the current local diagnosis, summarizes issues and quality score, and speaks the diagnosis if voice mode is on.
- After diagnosis, **Analyze & Preview** creates a proposed repair. **Clean & Download CSV** is the explicit user consent action; it applies the current repair engine, downloads a cleaned CSV, and attempts to save an aggregate audit run plus KDD observation in Supabase.
- Raw uploaded dataset rows are not sent to the chatbot API. Chat receives aggregate diagnostic context only. The API key remains server-side in `.env`.
- Voice output uses browser speech synthesis. Voice input records microphone audio with MediaRecorder and sends it to the server-side `/api/transcribe` endpoint for Groq Whisper transcription, avoiding the browser-dependent SpeechRecognition service. Configure `GROQ_API_KEY` in `.env` for transcription.

## Continuous Voice Agent (browser)

The Knowledge Assistant includes a Voice Mail-style hands-free voice session:
- Start/stop a continuous voice session from **Start Voice Agent**.
- In standby, say **Hey DataFix** to start a request.
- After the first request, speak naturally for follow-up questions without repeating the wake phrase.
- DataFix speaks replies in English (India) when a suitable browser voice is available.
- Voice interruption is enabled during responses: speak to interrupt and the transcript is carried into the next turn.
- Say **bye**, **goodbye**, or **stop listening** to return to wake-word mode.
- Use the Voice dropdown to select a browser English voice when available.


Speech recognition depends on the browser's Web Speech implementation and internet availability. Use a current Chrome or Edge browser, open DataFix on localhost or HTTPS, and grant microphone access. If recognition is unavailable in a browser, text chat remains available.

## Multi-format Data Quality Import

DataFix now accepts structured datasets, Office documents, text formats, images, audio and ZIP bundles. The importer extracts each format into an analysis-ready row representation before running the quality engine.


### Supported file extensions

- **Structured/table data:** `.csv`, `.tsv`, `.xls`, `.xlsx`, `.ods`, `.json`, `.jsonl`, `.ndjson`, `.xml`, `.parquet`
- **Documents:** `.txt`, `.pdf`, `.docx`, `.pptx`, `.odt`, `.odp`, `.html`, `.htm`, `.md`, `.markdown`, `.rtf`, `.eml`
- **Configuration/text:** `.yaml`, `.yml`, `.log`, `.sql`, `.ini`, `.cfg`
- **Images (OCR):** `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tif`, `.tiff`, `.gif`
- **Audio transcription:** `.mp3`, `.wav`, `.m4a`, `.ogg`, `.webm`, `.flac`, `.aac`
- **Archive:** `.zip` (up to 30 supported files are extracted; nested ZIPs are skipped)

### Format-specific extraction

- Excel/ODS: reads worksheets and combines their rows; multi-sheet files include a `Sheet` field.
- PDF: extracts text page-by-page. Pages with no embedded text (up to the first 20) are rendered and OCR'd.
- DOCX: extracts document text into text segments.
- PPTX: extracts text slide-by-slide.
- ODT/ODP: extracts text from the OpenDocument XML content.
- Images: OCR extracts English text and reports OCR confidence in the extraction metadata.
- Audio: Groq Whisper transcription turns audio into text segments for quality checks.
- ZIP: attempts to extract supported files and creates source-file-labeled text records.


### Extra setup for audio transcription

Audio transcription requires `GROQ_API_KEY` in the project `.env`. The key is used server-side by `/api/transcribe` and is never embedded into the browser bundle. Audio import currently has a 3 MB client upload limit to accommodate serverless request-size constraints. The Voice AI Agent also uses this server-side transcription endpoint; it no longer relies on browser `SpeechRecognition`.


### Important limits

Documents, OCR text and transcripts are converted into extracted text rows. The current quality engine then detects row/text quality patterns; it is **not** a full semantic document fact-checker or image/audio signal-quality lab. OCR is English-language. PDF OCR is attempted on text-empty pages up to 20 pages; ordinary PDF text extraction is available for the rest. Legacy binary `.doc` and `.ppt` are not supported (use `.docx`/`.pptx`). ZIP processing skips nested archives and limits extraction to 30 supported files. Parquet conversion is handled by a server endpoint and needs the project dependencies installed.
