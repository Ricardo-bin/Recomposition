**# Recomposition**

Recomposition is a mobile-first fitness tracking app built with vanilla JavaScript and Firebase.

\> Plan → Train → Adapt → Log → Review → Progress

**## Project structure**

\`\`\`text

Recomposition/

├── index.html

├── style.css

├── firebase.js

├── auth.js

├── navigation.js

├── dashboard.js

├── workout.js workout plans (editor)

├── logWorkout.js active workout session + saving the log

├── history.js

├── progress.js read-only analysis

├── settings.js settings hub + data management

├── profile.js

├── goals.js goals + nutrition recommendation / apply

├── nutritionEngine.js pure nutrition calculator (no DOM, no Firebase)

├── currentWeight.js the one resolver for "current weight" (from Weight History)

├── units.js weight unit helpers (kg / lb)

├── theme.js framework-free theme state + asset binding
├── themeAssets.js centralized Batman / Linkin Park asset registry

├── exercisePicker.js pure plan-exercise <-> library link helpers

├── exercisePickerUI.js the inline exercise picker (DOM)

├── data/

│ ├── recompositionData.js Firestore access (UID-scoped)

│ ├── exerciseLibrary.js read-only library API

│ └── exercise-library.v1.json curated exercises (25 in v1)

├── scripts/

│ └── validate-exercise-library.mjs

├── tests/
│ ├── theme.test.mjs
│ └── themeAssets.test.mjs

└── README.md

\`\`\`

**## Architecture**

Main navigation: **\*\*Dashboard · Workout · History · Progress · Settings\*\***.

\- **\*\*Progress is read-only.\*\*** It analyses and displays data (workout statistics, strength progression, personal

&#x20; records, weight history, body measurements). It contains **\*\*no data entry\*\***: its weight and measurement panels

&#x20; have a MANAGE button that opens the matching Settings page.

\- **\*\*Settings manages data:\*\*** Profile, Account, Weight History (add weight), Body Measurements (add measurement),

&#x20; Goals, Export & Backup.

\- **\*\*Workout\*\*** owns plans; **\*\*History\*\*** owns completed logs.

\| Module | Responsibility |

\| --------------------------- | ------------------------------------------------------------------------------------------------------- |

\| \`auth.js\` | Email/password and Google sign-in, password reset, profile creation (keeps the registration name). |

\| \`navigation.js\` | Main navigation. |

\| \`dashboard.js\` | Today's workout (with completed state), current weight, active goal, recent training. |

\| \`workout.js\` | Workout **\*\*plans\*\***: weekly schedule and exercise editor (with the exercise picker). |

\| \`logWorkout.js\` | The active **\*\*session\*\*** (sets, weight, reps, RIR, previous performance) and saving the **\*\*log\*\***. |

\| \`history.js\` | Completed logs: search, filter, view, edit, delete, "Load older workouts". |

\| \`progress.js\` | Read-only analytics. |

\| \`settings.js\` | Settings hub and sub-pages; exports (JSON, CSV, Excel). |

\| \`profile.js\` | Profile form (Settings → Profile). Shows the current weight read-only; it is managed in Weight History. |

\| \`goals.js\` | Goals and nutrition targets (Settings → Goals), including the recommendation review / Apply flow. |

\| \`nutritionEngine.js\` | Pure calculator: profile + current weight + goal type → recommended calories and macros. |

\| \`currentWeight.js\` | Resolves the current body weight from Weight History (used by Profile, Dashboard and Goals). |

\| \`data/recompositionData.js\` | All Firestore access, scoped to the signed-in user. |

**\*\*Plan / Session / Log\*\*** stay separate: a **\*\*plan\*\*** is what you intend to train; the **\*\*session\*\*** is the workout

in progress; the **\*\*log\*\*** is what you actually did. History reads logs, never plans.

**### Active workout session persistence**

The in-progress session is mirrored to \`localStorage\` under

\`recomposition.activeWorkoutSession.v1.\<uid>\` (one key per user, so accounts on the same device never see each

other's session). It is saved on every change, restored after a refresh or reopen, and removed when the workout is

completed or closed (Close is an explicit discard). Completing creates exactly one log; if the page is refreshed

while saving, the app checks Firestore before offering the session again, so a log is never duplicated.

Starting a different workout while one is in progress asks before discarding it.

**### Workout log queries**

Workout logs are read in pages, newest first (\`getWorkoutLogsPage\`, page size 100):

\- \`getWorkoutLogs()\` – the most recent page (Dashboard, restore check).

\- History – the first page, then **\*\*Load older workouts\*\*** pages further back.

\- \`getAllWorkoutLogs()\` – every log, page by page (Progress and all exports), capped at 5,000 as a safety limit.

Not paged: \`getWeightHistory()\` returns the latest 365 entries and \`getMeasurements()\` the latest 100.

**### Current weight (source of truth)**

**\*\*Weight History is the only source of truth for body weight.\*\*** There is no second, editable "current weight".

\`\`\`text

latest valid Weight History entry -> Current Weight -> Profile (read-only), Dashboard, Nutrition (Goals)

\`\`\`

\- \`currentWeight.js\` (\`resolveCurrentWeight\`) is the single resolver every screen uses, so they cannot disagree.

\- **\*\*Latest\*\*** means the greatest date. Two entries on the same date: the one added last (\`createdAt\`) wins; without

&#x20; \`createdAt\`, the first listed wins. Invalid entries (not a number, zero, negative) are skipped.

\- **\*\*Profile:\*\*** shows the value read-only with "Latest weigh-in: 03 Oct 2026" and a **\*\*Manage in Weight History\*\***

&#x20; button. It never saves a weight, never creates a weigh-in, and opening or refreshing it writes nothing.

\- **\*\*Adding a weight:\*\*** do it in Settings → Weight History. The Profile, Dashboard and Nutrition panel then use it.

\- **\*\*Legacy fallback:\*\*** older versions stored a weight on the profile document (\`currentWeight\`). It is only used,

&#x20; read-only and labelled as such, when there is no valid Weight History yet. The app no longer writes it, never

&#x20; clears it, and no existing data is migrated or rewritten. Once a weigh-in exists, history wins.

**### Units**

\`profile.unitPreference\` is \`"kg"\` or \`"lb"\` (the profile field is labelled **\*\*Weight unit\*\***; default kg).

\- **\*\*Stored body weights are always kilograms\*\*** (\`weightHistory[].weight\`). Switching the

&#x20; preference never changes stored data: values are converted only for display, and a typed value is converted back to

&#x20; kilograms (rounded to 0.01) before saving. See \`units.js\`.

\- The preference is applied to body weight on the Dashboard, Progress (weight history), Settings → Weight History and

&#x20; the Profile's read-only current weight (it re-displays when you flip the unit selector).

\- **\*\*Not covered by the preference:\*\*** exports (always kilograms, headers say \`Weight (kg)\`), lifting loads in

&#x20; sessions / History / Progress (unit-less numbers shown as kg), height (cm) and body measurements (inches).

&#x20; Making these unit-aware is a separate, not-yet-approved decision.

**## Nutrition**

Nutrition targets are stored on the **\*\*goal\*\*** (\`calories\`, \`protein\`, \`carbs\`, \`fat\`). They are the **\*\*active target\*\***

and the only numbers the Dashboard shows (it never calculates).

\`nutritionEngine.js\` is a pure module (no DOM, no Firebase, no writes). In Settings → Goals the user sees a

**\*\*recommendation\*\*** next to the **\*\*active\*\*** target and chooses whether to apply it:

\`\`\`text

profile + current weight + activity level + goal type

&#x20; -> BMR (Mifflin-St Jeor) -> TDEE -> goal adjustment -> calories / protein / fat / carbs

&#x20; -> user reviews (RECOMMENDED vs ACTIVE) -> APPLY RECOMMENDATION -> goal is updated

\`\`\`

Rules (formula version \`nutrition-v1\`):

\- **\*\*BMR:\*\*** \`10·kg + 6.25·cm − 5·age\` then \`+5\` (male) or \`−161\` (female). Sex "Other" / "Prefer not to say": no

&#x20; automatic calculation (the formula needs a biological-sex coefficient); use a Custom goal.

\- **\*\*TDEE = BMR × activity:\*\*** sedentary 1.2 · lightly active 1.375 · moderately active 1.55 · very active 1.725 ·

&#x20; extremely active 1.9. Individual workouts add nothing on top.

\- **\*\*Goal adjustment of TDEE:\*\*** Maintenance 0% · Recomposition 0% · Lean Bulk +5% · Bulk +10% · Cut −15% ·

&#x20; Fat Loss −20% · **\*\*Custom: never calculated\*\*** (fully manual).

\- **\*\*Protein\*\*** 1.8 g/kg (2.0 g/kg for Cut and Fat Loss) · **\*\*Fat\*\*** 0.8 g/kg · **\*\*Carbs\*\*** = remaining calories ÷ 4.

\- **\*\*Rounding:\*\*** calories to 10 kcal, protein / fat / carbs to 5 g. Macros add up to the calories within 10 kcal.

\- **\*\*Validation:\*\*** age 18–100, height 100–250 cm, weight 30–300 kg (kilograms, converted with \`units.js\`), sex

&#x20; Male/Female, a known activity level and goal type. Anything missing or impossible returns clear errors and no

&#x20; numbers; a calorie target too low for the protein and fat targets also returns an error, never negative carbs.

\- **\*\*Current weight:\*\*** the latest valid Weight History entry (see Current weight above); the legacy profile weight is

&#x20; only a fallback when there is no history. Weight History is never modified.

Nothing is ever applied automatically. A new weigh-in only changes the \_\_recommendation\_\_ the next time Goals is

opened. Applying (with confirmation when it replaces different numbers) writes the four fields plus light metadata

to the same goal document: \`nutritionSource\` (\`recommended\` / \`manual\`), \`nutritionAppliedAt\`,

\`calculatedFromWeightKg\`, \`calculatedFromGoal\`, \`nutritionFormulaVersion\`. Goals saved by hand are marked \`manual\`

only when their numbers change; existing goals saved unchanged are left exactly as they were.

Not implemented (future): target weight / target rate fields and any adjustment based on weight \_\_trend\_\_.

**## Exercise Library**

A curated, read-only library ships with the app as \`data/exercise-library.v1.json\` (25 exercises in v1). Always

use \`data/exerciseLibrary.js\` (search by name or alias, lookup by id, indexes by muscle, movement pattern and

equipment); never read the JSON directly.

In the workout plan editor, the exercise name box is a search-as-you-type picker:

\- \`exercise.id\` is the **\*\*plan slot id\*\*** (a random UUID, never changed).

\- \`exercise.libraryExerciseId\` is the **\*\*optional\*\*** library identity. Only an explicit selection sets it.

\- Typing in the name box unlinks the exercise (it becomes a custom exercise); the slot id is kept.

\- Plans without \`libraryExerciseId\` are custom exercises and keep working unchanged.

\- If the library cannot load, the editor still works: custom names can always be typed.

Validate the library after editing it: \`node scripts/validate-exercise-library.mjs\`

**## Tests**

\`\`\`bash

node --test tests/\*.test.mjs

\`\`\`

Library, helper, unit and nutrition-engine tests need nothing installed. The DOM tests (picker UI, workout editor,

units, session persistence, Goals / nutrition) use jsdom and are **\*\*skipped\*\*** if it is missing:

\`\`\`bash

npm install --no-save jsdom

\`\`\`

**## Design system**

\`style.css\` ends with the design-system layers (sections 19 onward):

\- Tokens: colours, spacing (\`--space-\*\`), type scale (\`--text-\*\`), radius, motion.

\- Global baseline for inputs, selects, buttons (focus, disabled, touch feedback), written with \`:where()\` so

&#x20; specific rules still win.

\- Shared components: \`.page-header\`, \`.card\`, \`.section-label\`, \`.empty-state\`, \`.loading-state\`, \`.error-state\`,

&#x20; \`.success-state\`, and the exercise picker.

\- Fonts: Batman Forever for headings and labels, Chakra Petch for body and inputs.

**## Firebase data model**

\`\`\`text

users/{uid}

├── workoutPlans/{planId}

├── workoutLogs/{logId}

├── weightHistory/{entryId}

├── measurements/{entryId}

└── goals/{goalId}

\`\`\`

Firestore rules restrict each signed-in user to their own \`users/{uid}\` tree and deny everything else.

**### Stored-field notes**

\- Plans: \`dayOfWeek\` (1–7); exercises have \`id\` (slot), optional \`libraryExerciseId\`, \`name\`, \`sets\`, \`repMin\`,

&#x20; \`repMax\`, \`targetRIR\`, \`restSeconds\`, \`notes\`.

\- Logged sets: \`weight\`, \`reps\`, \`rir\` (typed numbers, unit-less).

\- Body weight: kilograms, stored in \`weightHistory\` (\`{ weight, date, createdAt }\`). A legacy \`currentWeight\` may

&#x20; still exist on the profile document; it is a read-only fallback and is no longer written. Height: centimetres.

\- Measurements are in inches and may exist as \`shoulders\`/\`shoulder\`, \`thighs\`/\`thigh\`, \`arms\` or

&#x20; \`leftArm\`/\`rightArm\`; the UI and exports read all of them.

\- Goals: \`goalType\`, \`calories\`, \`protein\`, \`carbs\`, \`fat\`, \`startDate\`, \`endDate\`, plus optional nutrition metadata

&#x20; (\`nutritionSource\`, \`nutritionAppliedAt\`, \`calculatedFromWeightKg\`, \`calculatedFromGoal\`,

&#x20; \`nutritionFormulaVersion\`). The four nutrition fields are the **\*\*active\*\*** target: typed by hand or applied from a

&#x20; recommendation (see Nutrition).

**## Local development**

\`\`\`bash

cd Recomposition

python3 -m http.server 5500

\`\`\`

Open \<http\://localhost:5500>. This server has no auto-reload, so hard-refresh (Cmd+Shift+R) after editing files.

**## Known limitations**

\- Lifting loads, height and body measurements are not covered by the unit preference (see Units).

\- Weight history is capped at the latest 365 entries and measurements at the latest 100.

\- Measurement units are implicit (inches) and not labelled on the Settings entry form.

\- Nutrition v1 does not use target weight, target rate or weight trend, and does not adjust for individual

&#x20; workouts. Automatic recommendations are for adults (18+) with Male / Female in the profile.

\- A saved workout session lives in one browser on one device.

\*\*## Theme assets

The canonical theme asset documentation is in **Theme system** above.

The asset registry in `themeAssets.js` currently defines:

- `batman` → **Batman Dark**
- `linkin-park` → **Linkin Park Light**

Each theme has seven asset slots:

`logo.svg`, `hero.webp`, `dashboard.webp`, `profile.webp`, `background.webp`, `decorative.webp`, `texture.webp`.

Place the actual user-provided files under:

```text
assets/themes/batman/
assets/themes/linkin-park/
```

Do not change component code when replacing artwork; the centralized registry is designed so the files can be replaced independently of application/business logic.
