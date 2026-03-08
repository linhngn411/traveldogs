# 🐾 TravelDogs

> Your adventure companion — plan, explore, create.

## 📁 Project Structure

```
traveldogs/
├── index.html          # Main shell (HTML only, no inline logic)
├── css/
│   └── main.css        # All styles (bamboo theme)
├── js/
│   └── app.js          # All app logic
├── data/
│   └── trips.json      # ← ALL trip data lives here
└── README.md
```

---

## 🚀 Running locally

Because the app fetches `trips.json` via `fetch()`, you **cannot** open `index.html` directly as a `file://` URL — the browser will block the request.

Use any static server:

```bash
# Option 1 — Node
npx serve .

# Option 2 — Python
python3 -m http.server 8080

# Option 3 — VS Code Live Server extension
```

Then open `http://localhost:3000` (or whichever port).

---

## 🌐 GitHub Pages deployment

1. Push this folder to a GitHub repo (e.g. `traveldogs`)
2. Go to **Settings → Pages → Source: `main` branch, root `/`**
3. Save → your app is live at `https://<username>.github.io/traveldogs`

---

## 📄 trips.json — Full Schema

```jsonc
{
  "trips": [
    {
      // ── Trip metadata ──────────────────────────────
      "id":          "dalat-2025",        // unique string ID
      "name":        "🌿 Đà Lạt Trip",    // display name (emoji OK)
      "emoji":       "🌿",               // card banner emoji
      "dates":       "March 13–15, 2025", // human-readable date range
      "persons":     4,                   // number of travellers
      "departDate":  "2025-03-13T00:00:00", // ISO date for countdown (null = no countdown)
      "placeholder": false,              // true = greyed-out "coming soon" card

      // ── Days array ─────────────────────────────────
      "days": [
        {
          "id":    "day-1",           // unique string ID
          "label": "Day 1 – Đà Lạt", // tab label
          "date":  "March 13",        // sub-label shown on timeline header

          // ── Timeline items ──────────────────────────
          "items": [
            {
              "id":        "d1_1",         // unique string ID
              "time":      "08:00",        // 24h time string (for sorting)
              "timeLabel": "8:00 AM",      // display label

              "task":  "Ăn sáng",         // short activity title
              "type":  "food",            // see Type values below

              // From location (always required)
              "from": {
                "name":   "Mì quảng Dì Út",
                "lat":    11.9455,
                "lng":    108.4362,
                "mapUrl": "https://maps.app.goo.gl/..." // or null
              },

              // To location (null if single-point activity)
              "to": {
                "name":   "Quảng trường Lâm Viên",
                "lat":    11.9358,
                "lng":    108.4416,
                "mapUrl": "https://maps.app.goo.gl/..." // or null
              },
              // ↑ set "to": null for single-location items

              "transport": "Xe máy",      // free text: Grab, Đi bộ, Xe khách…

              // Cost object — set to null if no cost info
              "cost": {
                "total":     200000,      // total for the group (VND)
                "perPerson": 50000,       // per person (VND), null if N/A
                "note":      "50k/phần"   // free text note about the cost
              },

              "note":    "Nếu nghỉ bán thì...", // optional tip / note
              "preBook": false,          // true = show "⚠️ Cần đặt trước" badge

              // Content array — for future photo/video upload feature
              // Each item: { "type": "image"|"video"|"link", "url": "...", "caption": "..." }
              "content": []
            }
            // … more items
          ]
        }
        // … more days
      ]
    }
    // … more trips
  ]
}
```

---

## 🏷️ Item `type` values

| Value     | Badge colour | Meaning              |
|-----------|-------------|----------------------|
| `travel`  | Blue        | Transport / moving   |
| `food`    | Yellow      | Eating / drinking    |
| `photo`   | Red         | Check-in / content   |
| `hotel`   | Teal        | Hotel / accommodation|
| `shop`    | Purple      | Shopping             |
| `coffee`  | Brown       | Café                 |
| `night`   | Dark blue   | Night activity       |
| `sleep`   | Grey-blue   | Sleep / rest         |

---

## ➕ Adding a new day or activity

**New activity** — add an object to the `items` array of the correct day:
```json
{
  "id": "d1_18",
  "time": "09:00",
  "timeLabel": "9:00 AM",
  "task": "Tên hoạt động",
  "type": "photo",
  "from": { "name": "Tên địa điểm", "lat": 11.9400, "lng": 108.4400, "mapUrl": null },
  "to": null,
  "transport": "Xe máy",
  "cost": { "total": 0, "perPerson": 0, "note": "" },
  "note": "",
  "preBook": false,
  "content": []
}
```

**New day** — add an object to the `days` array:
```json
{
  "id": "day-2",
  "label": "Day 2 – Đà Lạt",
  "date": "March 14",
  "items": [ /* ... */ ]
}
```

**New trip** — add a full trip object to the `trips` array.
