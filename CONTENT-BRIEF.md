# Content brief — verified facts only

Source of truth for every word on this site. It comes from a line-by-line
accuracy audit of Gauresh's resume plus the six repos now public at
github.com/gauresh99.

**The governing rule of that audit, which governs this site too: nothing goes
on the page that cannot be defended under questioning by someone who does the
work daily.** Specificity you cannot defend is worse than vagueness, because it
turns a good interview into a bad one. Do not invent a metric, a date, a dataset
size, a model architecture, a team size, or a technology. If it is not below, it
does not go on the site.

## Identity

- Gauresh Maheshwary
- B.S. Computer Engineering, UIUC (Grainger College of Engineering)
- Minors: Mathematics, Business Studies
- Expected May 2027 · GPA 3.57
- Urbana-Champaign, IL
- gauresh2@illinois.edu
- linkedin.com/in/gauresh-maheshwary19
- github.com/gauresh99

Positioning: embedded firmware first, applied ML for constrained hardware
second. The through-line worth writing to is that he keeps choosing the design
the deployment target allows rather than the most impressive one.

## Timeline, oldest to newest

**Sakha — self-founded venture, ~2019–2023 (grades 9–12).** Retrofit kit that
motorises an existing manual wheelchair rather than replacing it, voice-driven
through an Android app. Arduino, HC-05 Bluetooth, brushed DC motor through an
external driver, PWM speed and direction. Voice chain: enrollment → speaker
verification → speech-to-text (English and Hindi) → command parsing → Bluetooth.
Cost: ₹48,000 down to ₹29,999. Won Young Entrepreneurs Academy India nationals
(selected to represent India internationally; cancelled due to COVID). Top 10 of
~10,000 at Young Tycoons Business Challenge 2022. ~$10,000 total prize money
across 15+ contests.
*Never write:* any Harvard affiliation; any BLDC implementation claim (the build
used brushed DC); autonomous navigation or geofencing as built (researched only).

**Independent cross-validation research — grade 12.** Self-directed study of
hyperparameter tuning versus K-fold cross-validation, in the pre-LLM classical
ML world (scikit-learn, grid and random search). The specific techniques
compared and the conclusion are not recalled, so keep this to one line and do
not state findings.

**INTAI — mock interview platform, freshman year 2023–24, 2 people.** Real-time
interview scorer. One OpenAI API call per session parses the resume into a
candidate-specific keyword list; per-answer scoring is keyword coverage against
that list, plus a pretrained facial-emotion classifier (integrated via OpenCV,
never retrained) with his own post-processing into confidence signals, plus a
vocal pipeline over volume, speaking rate and pause behaviour. C ring buffer for
per-frame confidence aggregation. Demoed to a hospitality-sector training
company in India. The collaborator owned the JavaScript frontend.
*Never write:* "fine-tuned" the emotion model; "LLM answer grading"; "semantic
evaluation"; naming Google Speech-to-Text as the implemented provider.

**Radius Synergies International (EVCD), Noida — BLDC Motor Control Systems
Intern, Jun–Aug 2024.** Tore down a commercial Atomberg BLDC ceiling fan,
identified driver and motor, worked the full register map of TI DRV10983/DRV10987
integrated sensorless drivers, measured the back-EMF constant across the speed
range, wrote C and assembly to set speed and configuration registers over I²C,
validated closed-loop speed control on hardware. Enabled multi-speed reverse
(exhaust) on a unit that shipped with one fixed exhaust mode, and measured
current draw at each reverse speed — toward letting factories run exhausts on
demand. Worked under a senior embedded engineer with 25+ years in firmware and
chip bring-up.
*Never write:* six-step commutation; external gate driver (the part has
integrated MOSFETs and runs 180° sinusoidal commutation itself); EEPROM
programming; any MCU-side STM32 firmware ownership; any efficiency percentage.

**Omnie Solutions, Noida — ML Applications Intern, May–Aug 2025, 12 weeks,
14-person team.** Built a keyword-trend/SEO pipeline for a US client: began as a
sentiment classifier feeding a rule-based scoring layer in the same pipeline.
NumPy, scikit-learn, PyTorch, pandas, matplotlib. Reports shipped to a live
client who used them to select keywords; campaign performance fed back into the
next round.
*Never write:* Aumcore as the employer (that was the client); any reinforcement
learning or bandit language.

**STAT 420 — credit-limit modelling in R, junior year.** Regression on the UCI
Credit Card Clients dataset, 30,000 Taiwanese clients, predicting credit limit.

**Warret and StyleMind — personal apps, summer 2025 onward.** Both built with AI
coding assistance. The claiming rule that came out of them, and which should
appear somewhere on this site because it is genuinely his: *in an AI-assisted
build you own the decisions you can defend, not the lines you accepted.*

**Energy and Multiphase Flow Lab, MechSE — Undergraduate Researcher, May 2026 to
present.** The strongest entry. A US split air conditioner has a structural
information gap: the outdoor unit and the thermostat are often made by different
companies, so the outdoor controller cannot read indoor conditions and hunts for
compressor frequency instead of settling. The lab infers the indoor state from
outdoor signals, then controls on that inference. He owns the inference half; a
colleague owns the reinforcement-learning control agent.

Built reduced-order models replacing a physics-based thermal simulation: Ridge
for indoor temperature, Lasso for cooling rate, RBF spline surrogates, on a
degree-2 polynomial feature expansion of five outdoor-unit signals (compressor
frequency, outdoor temperature, condenser coil temperature, compressor discharge
temperature, evaporator outlet pressure). ~200 samples, because each simulation
run takes 30 minutes; ~20 terms after expansion, roughly 10:1. R² = 0.99 under
leave-one-group-out CV — grouped because points from the same simulation run are
correlated and a random split would leak across folds. 30 minutes down to 20 ms.
Synthetic data expansion validated against experimental variance and correlation.
24k BTU system complete; 36k and 55k in progress. Not deployed.

The thesis, and the best line on the whole site: **a regularized degree-2
polynomial is a handful of multiply-accumulates and ports to C trivially, where
a neural surrogate would have been more expressive and less deployable. The
model form was chosen by the deployment target, not by accuracy.** Framed
properly this is a *virtual sensor*, which is a named pattern in embedded control.
*Never write:* any ownership of the RL control work; a C firmware port as work in
progress (it is next-phase scope); the sponsor's name or system details (an NDA
may apply and the advisor has not signed off); any claim on the collaborator's
thermal/refrigerant-cycle modelling.

## The five projects — these are the five penalties

Use the repo name as `id`. All five are live and public.

1. **bldc-drv1098x-bringup** (C) — I²C bring-up of the TI sensorless BLDC
   driver. *Highlight:* `SysOpt1` is a shared register holding open-loop current
   and acceleration settings next to the reverse-drive enable, so every partial
   update is a masked read-modify-write — write the whole register and the fan
   stops starting on some later run for reasons that look nothing like what you
   changed. *Provenance:* original internship code lost; rewritten 2026 from
   notes and the TI datasheet, with AI help.

2. **sakha-wheelchair** (C, Python, Kotlin) — the wheelchair retrofit.
   *Highlight:* firmware stops the motor after 900 ms of silence, so one spoken
   "forward" would move the chair for under a second. A command is therefore
   held, not latched — the phone pings every 300 ms, and a dropped link, a
   crashed phone and a closed app all stop the chair because from the Arduino's
   side all three look identical. *Provenance:* original code lost; rewritten
   2026 from notes, with AI help.

3. **intai-mock-interview** (Python, C) — the interview scorer. *Highlight:* the
   ring buffer alone is wrong. It holds the last N frames, which is right for
   "how are they doing now" and wrong for "how did the session go" — once it
   wraps, the average quietly becomes the last few seconds of a forty-minute
   interview. A running sum and count sit alongside it: exact over every frame,
   still constant memory. *Provenance:* backend rewritten 2026 from notes, with
   AI help; collaborator's frontend not included.

4. **warret** (TypeScript) — warranty vault on Expo and Supabase. *Highlight:*
   "what expires next" is asked on every screen and after every sync, and each
   time about ten results are kept and the rest binned; a binary min-heap makes
   that O(n) to build and O(k log n) to read instead of re-sorting. Row-level
   security across seven migrations, several of which exist because the first
   version of a policy was too permissive. Document extraction runs in a
   Supabase Edge Function so the model key never ships to a phone.
   *Provenance:* built with AI coding assistance.

5. **stylemind** (JavaScript) — offline browser wardrobe app. *Highlight, and
   lead with this one:* fit classification broke in practice, not because the
   model was bad but because of how people photograph clothes. They shoot to
   record colour — hanging, bunched, at an angle — and nobody lays a t-shirt
   flat to show its cut. The data users produce and the data the classifier
   needed were different distributions, which is the failure mode most deployed
   ML actually hits, and more data of the same kind only teaches the same wrong
   thing. *Provenance:* built with AI coding assistance, end to end.

## Coursework

Completed: ECE 391 (Computer Systems), ECE 385 (Digital Systems Lab), ECE 210,
ECE 120, ECE 110, CS 225, CS 374, CS 357, STAT 420, MATH 257, MATH 285, PHYS 212.
In progress: ECE 330, IE 421 (High Frequency Trading Tech), CS 441 (Applied ML),
STAT 410.

Coursework **code** stays private — publishing working solutions to current labs
creates academic-integrity problems for students taking them now. Say that
plainly on the site; it reads as a deliberate choice rather than a gap.

## Tone

First person. Plain. The repos' READMEs are the voice to match — they open with
what happened rather than a thesis, admit what broke, and name what was someone
else's. Do not write marketing copy. No "passionate about", no "cutting-edge",
no "leveraging". Short sentences are fine. Being specific about one real
difficulty beats three adjectives.
