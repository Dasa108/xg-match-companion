# How This Was Built — Explained Simply

This is the same project as [`process.md`](process.md), but told in plain language, for
someone who has never built anything like this before. No assumed knowledge of machine
learning, websites, or any of the tools. Every idea here really happened in this project —
this isn't a generic tutorial, it's *this* build, just explained gently.

Think of it as the story version. If a part of the story makes you curious about the exact
code or the exact numbers, `process.md` has a matching, numbered section for almost
everything here — look for the `(see process.md — ...)` pointers.

---

## What are we even building?

A website that watches a football (soccer) match with you. Every time someone takes a
shot, you tap where it happened on a little drawing of the pitch, answer a couple of quick
questions, and the website instantly tells you: *"how good was that chance, really?"* — a
number between 0 and 1 called **xG**, short for **expected goals**. A shot from right in
front of goal might be 0.4 (a good chance). A hopeful strike from the halfway line might be
0.01 (almost never goes in). At the end of the match, it adds everything up and tells you
which team actually created the better chances — which isn't always the team that won.

That's the whole idea. Everything else in this document is *how you'd actually go about
building that*, one honest step at a time.

---

## Step 0: Write down what you're building, before writing any code

This sounds like it slows you down. It's the opposite. Before touching a keyboard, this
project wrote a document (`spec.md`) answering questions like:

- Exactly what does the person on the sideline tap, and in what order?
- Exactly what does the computer need to know to guess "how good was that chance"?
- How do we know if the guess is any good — what number counts as "good enough to ship"?

Why bother? Imagine building a whole app around "the model needs 20 pieces of information
about each shot," and only realizing *after* it's built that a person standing on a
sideline, watching a live match, physically cannot type in 20 things before the next thing
happens. Every one of those 20 things becomes a decision made twice — once when you build
it, once when you rip it back out. Writing the plan down first means you make each decision
*once*, and you make it thinking about the actual person using this, not just what would be
technically nice to have.

**The big idea:** decide → write it down → build → and if reality disagrees with the plan
later, update the plan too, on purpose, so it never goes stale.
*(see process.md — Phase 0)*

---

## Step 1: Teach a computer to guess "was that a good chance?"

This is the "machine learning" part, and it's less mysterious than it sounds.

Imagine you had a giant book of real football shots — thousands and thousands of them —
and for every single one, you knew: how far from goal it was, how central it was, whether
it went in or not. If you read enough of these, you'd start noticing patterns yourself:
shots from close range and straight in front score a lot more often than shots from a
tight angle near the goal-line. A computer can learn the exact same kind of pattern, just
from way more examples than a person could ever personally remember, and with more
precision about *how much* each factor matters.

This project used a real, public collection of match data called **StatsBomb Open Data** —
free, real professional match data, shot by shot. After picking a good, varied slice of it
(not just one team's matches, or the model would basically learn "this one team is good," not
"what makes a good chance") — this project ended up with **34,809 real shots** to learn
from.

**The two most important clues, by far:** how far away the shot was, and how wide an angle
of the goal the shooter could actually see (a shot from 6 metres out, dead central, sees
almost the whole goal; a shot from 6 metres out but right on the goal-line barely sees a
sliver of it — very different chances, same distance). Everything else — which foot, how
much pressure, where the keeper was standing — refines that starting guess.

**The most important trick to avoid fooling yourself:** if you test the computer's guesses
on the *exact same shots* it learned from, of course it looks amazing — it's basically just
remembering the answers, not actually learning the pattern. So you always hide some shots
away, never let the computer see them while it's learning, and only check its guesses
against those hidden ones at the very end. This project even hides shots *by match*, not
one-by-one — two shots from the same game are too similar to each other (same weather, same
two teams, same referee) to count as a fair, independent test if one sneaks into "practice"
and the other into "the real test."
*(see process.md — 1.2, 1.3, 1.4)*

### A real mistake this project actually made here

The first attempt tried to be extra rigorous by testing the model only on whole
*tournaments* it had never seen at all — seemed like an even fairer test. But those
tournaments happened to have a slightly different mix of easy/hard chances than everything
else, and the model's confidence numbers came out a little off as a result — not because the
model was bad at telling good chances from bad ones, but because the *population* it was
tested on wasn't quite the same shape as the one it learned its confidence from. The fix was
switching to hiding individual matches spread across every competition, not whole
competitions. The lesson that came out of this: "is my model accurate" and "is my model
*calibrated*" are two different questions, and a good score on one doesn't guarantee a good
score on the other.
*(see process.md — 1.5)*

---

## Step 2: Make sure the confidence numbers are actually trustworthy

Here's a subtle but important idea: it's not enough for the computer to correctly say
"chance A was better than chance B." The actual *number* has to mean something too. If the
model says a shot is a 0.30 (30%) chance, then out of a hundred real shots it rated exactly
like that, roughly 30 of them should have actually gone in — not 10, not 70.

This is exactly like a weather forecaster. If someone says "70% chance of rain" constantly,
and it only actually rains 20% of the time they say that, you'd stop trusting their
percentages, even if they're technically "right" that rain is more likely on the days they
mention it at all.

This project fixed this with an extra step after the model learns its patterns, called
**calibration** — basically a translation table that nudges the raw guess into a properly
trustworthy percentage, checked separately for "lots of info given" vs. "barely any info
given," since those two situations have different error patterns.
*(see process.md — 1.6)*

---

## Step 3: Let the model work with whatever you actually had time to tell it

On a real sideline, you don't always have time to note everything about a shot before the
next thing happens in the match. Sometimes you'll only manage to tap where the shot was.
Sometimes you'll have time to also mark where the goalkeeper was standing, how much
pressure the shooter was under, and more.

Rather than build two separate tools — a "quick mode" and a "detailed mode" — this project
trained *one* model to handle the whole spectrum, by deliberately practicing with
information missing during training. Concretely: every real shot in the training data was
shown to the model multiple times — once with everything filled in, and several more times
with random pieces blanked out on purpose — so the model gets good at guessing sensibly no
matter how much (or how little) it's told, the same way a doctor still forms a reasonable
diagnosis with whatever test results happen to be available, rather than refusing to guess
until every possible test has come back.
*(see process.md — 1.4)*

---

## Step 4: Get the trained "brain" out of the training program and into a phone

Here's a problem: the model was trained using Python, a programming language great for
this kind of data science work. But the actual app runs in a web browser, which mostly
speaks a completely different language (JavaScript/TypeScript). You can't just copy-paste a
Python program into a website and expect it to run.

The fix is a format called **ONNX** — think of it like exporting a Word document as a PDF.
The PDF isn't a Word document anymore, but *any* PDF reader on *any* computer can open it
and see exactly the same thing. ONNX does that for a trained model: Python saves the
model's learned patterns into one ONNX file, and a completely different program
(`onnxruntime-web`, running right there in the browser) can load that file and get the
exact same predictions, without ever needing Python again.

Why does this matter enough to be its own step? Because it's what makes the whole "works
with no internet" idea possible. If predictions needed a server somewhere to do the maths,
the app simply wouldn't work on a sideline with no signal — which, per the spec written in
Step 0, is the normal condition this app has to work in. Doing the maths **on the phone
itself** was the one decision that made everything else about "no server, no signal
needed" possible.

**A gotcha worth knowing about:** exporting a model doesn't automatically prove the export
is *correct*. This project double- and triple-checked that the ONNX version gives the exact
same answer as the original Python model — matching to seven decimal places — before
trusting it for a single real prediction.
*(see process.md — 1.8)*

---

## Step 5: Build the thing people actually tap on

This is the "website" part. A few pieces, each doing one job:

- **React** — a way of building a web page out of small, reusable pieces ("components"),
  like Lego bricks: one piece draws the pitch, one piece draws the scoreboard, one piece
  draws the report, and they get snapped together into the full app.
- **The pitch itself** is just a drawing (an SVG — think of it as a picture made of shapes
  and coordinates instead of pixels) that listens for taps and converts "you tapped here"
  into "that's this many metres from the goal, at this angle."
- **A tiny private database inside the browser** (called IndexedDB) stores every match,
  player, and shot — right there on the phone, nowhere else. No password, no account, no
  server database somewhere else in the world holding onto anyone's data.
- **A "service worker"** — think of it like saving a map on your phone before a hike with
  no signal. The very first time you open the site (with a connection), it quietly saves a
  full copy of everything the app needs — the code, and both trained models — onto the
  device. After that, opening the site works exactly the same with the phone in airplane
  mode, because everything it needs is already sitting there.

**Why so many small, separate pieces rather than one big program?** Because each piece can
be checked on its own. If the pitch-tapping math is wrong, you can test *just* that, without
needing to also run the whole app, load a model, and click through five screens first. That
turns out to matter a lot for the next step.
*(see process.md — Phase 2)*

---

## Step 6: Make sure the same maths, written twice, actually agrees with itself

Here's a tricky problem that's easy to miss: the "how far, what angle, how much pressure"
maths has to exist **twice** — once in Python (used while training the model), and once in
TypeScript (used live, in the browser, every time someone taps a shot). If those two
versions ever calculate things even slightly differently, the live app would quietly give
different xG numbers than the ones the model was actually trained and tested on — and you'd
have no way to notice, because both versions *look* like they're working.

The fix: build a shared "answer key". Take 48 real shots, run them through the *Python*
maths, and write down the exact expected result for each one. Then, whenever the
TypeScript version runs, automatically check its answer against that same answer key. If
they ever disagree by more than a tiny rounding difference, a test fails immediately and
loudly — long before a real person ever sees a wrong number.

This project leaned on this idea constantly, for every single new feature that needed the
same logic in two places (the main model, and later a second "how good was the placement"
model). It's one of the single most valuable habits in the whole project: **whenever the
same rule has to exist in two places, write an automatic check that they still agree,
rather than trusting yourself to remember to keep them in sync by hand.**
*(see process.md — 1.8, 2.4)*

---

## Step 7: Build the "what happened" summary, out of small honest pieces

At full time, the app needs to answer: who created the better chances, who was the best
player, and show some charts. The way this got built: write small, separate functions that
each do one simple, well-defined job — "given the shots, calculate each team's total xG,"
"given the totals, write one sentence describing who deserved it," "given the shots,
build the data for a chart" — and *keep the actual drawing (the charts, the layout)
completely separate from those calculations*.

Why separate them? Because the calculation ("Rovers deserved to win, 2.1 xG to 0.8") is
something you can test automatically and be completely sure is correct. The drawing (does
the chart look nice, is the text laid out well) is something you mostly just have to look
at. Mixing the two together means every visual tweak risks quietly breaking a number nobody
is watching closely enough to notice went wrong.

One more honest thing worth naming: this report includes a plain-English sentence
explaining *why* a shot got the xG number it did (things like "close range, tight angle").
That explanation is a simple, honest rule-of-thumb reading of the numbers — not the model
genuinely explaining its own reasoning (a much harder, different technique exists for real
model explanations, called SHAP, and this project deliberately didn't pretend to have that
when it doesn't). Saying clearly what a feature *isn't* is just as important as saying what
it is.
*(see process.md — Phase 3)*

---

## Step 8: Test it for real, not just in your head

Every piece of maths in this project got an automatic test. That gives you real confidence
the *logic* is right. It does **not** guarantee the actual, real app works — and this
project hit two genuinely different bugs that no amount of logic-testing could have ever
caught, because they were bugs about *how the browser actually loads and runs things*, not
bugs in the maths:

1. A file was being loaded from the wrong folder in a way that only fails inside a real
   browser, never inside the automated tests (which don't use a real browser to test the
   loading process itself).
2. The model-running library defaulted to a fancier mode that needs a browser security
   feature this site doesn't turn on — which caused the whole page to silently freeze the
   *first* time a real person actually clicked into the live screen, despite every
   automated test passing.

Neither bug showed up until this project was actually clicked through in a real browser,
on a real screen. The lesson: **automated tests and "actually opening the thing and using
it" catch genuinely different categories of mistakes. You need both, and skipping the
second one because the first one is green is a real, common way projects ship something
broken that "should" have worked.**
*(see process.md — 4.1, 4.2 — and honestly, most of Phase 6 too)*

---

## Step 9: Make it look good — but *checked*, not just eyeballed

A good-looking app isn't just "does it look nice to me right now." Two examples from this
project of turning "looks nice" into something you can actually verify:

- **Colour-blindness.** About 1 in 12 men can't tell red and green apart easily. If a shot
  outcome is shown *only* by colour (say, green dot = goal, red dot = saved), a colour-blind
  person literally cannot read your chart. The fix here was giving every outcome its own
  **shape** as well as colour (a star for a goal, a circle for a save, and so on) — and,
  rather than just picking colours that *looked* distinguishable, running them through an
  actual calculation (based on how human colour vision works, called OKLab) that checks two
  colours are far enough apart for someone with colour-blindness to still tell them apart.
  One pair genuinely failed this check the first time and had to be changed — something
  eyeballing would very likely have missed entirely.
- **Matching your own theme, not a generic one.** When adding background decoration, colours
  and shapes were checked against the app's actual real background colour, computed, rather
  than just guessed to "probably look fine."

The broader idea: wherever you can turn a design opinion ("this looks readable") into an
actual number you can calculate and check, do that — it catches real problems a quick look
never will.
*(see process.md — 6.2, 6.3)*

---

## Step 10: Put it somewhere a real person can actually open it

A finished app sitting only on one person's laptop isn't very useful yet. **GitHub Pages**
is a free way to host a plain website — you give it your built files, and it hands you back
a real, public web address. This project set up a small robot (a "GitHub Actions workflow")
that automatically rebuilds and republishes the site every time new code is pushed, so
"ship the latest version" is a single push, not a manual multi-step chore.

**A real gotcha hit here:** a website hosted this way lives at a slightly different web
address shape (`yoursite.github.io/your-project-name/` instead of just
`yoursite.github.io/`) than a normal locally-tested site does. Get this detail wrong and
the page *loads*, but every file it then tries to fetch (its own code, its images) asks for
the wrong address and silently fails — a blank page with zero error message, because from
the browser's point of view, nothing "crashed," it just quietly couldn't find anything.
This is exactly the kind of bug Step 8's lesson is about: it only ever showed up by actually
opening the real, live site and looking.
*(see process.md — 6.15)*

---

## Step 11: Decide what happens when the site changes after people already have it open

Once a website is live and a real person has it open on their phone, a new problem appears
that a from-scratch build never has to think about: **what happens the next time you ship
an update, to someone who already loaded yesterday's version?**

This project actually tried two different answers, on purpose, and it's worth knowing why
it landed where it did:

1. **First attempt:** ask the person — show a little banner saying "a new version is
   ready," with a button to reload. Safe, and very explicit.
2. **What actually got kept:** update automatically and silently, the moment a new version
   is noticed, no button needed — because for this particular app, "typed instructions on a
   sideline" beats "please tap this extra button," and there's nothing here so sensitive
   that a surprise reload mid-use would actually hurt anything.

Neither answer is *the* correct one in general — it depends entirely on what you're
building and who's using it. The one thing worth keeping regardless of which you choose:
**tell the truth about what the app can't know.** This one specifically can't check for
updates while offline — so instead of pretending everything's always current, it shows a
small, honest, un-clickable note whenever you're disconnected: *"you might not have the
very latest version right now, and there's no way to check until you're back online."*
That's a genuinely different, and better, habit than either silently updating *or* silently
staying quiet about the one case where staleness can actually happen.
*(see process.md — 6.19, 6.20, 6.21)*

---

## Step 12: Keep listening after it's "done"

Nearly every entry above Step 7 in this file came from someone actually using the finished
app and noticing something — "there's no button to end the match," "it ends the match
without warning me it's early," "I don't see an option to go home afterward." None of these
were bugs an automated test could have caught, because none of them are wrong *maths* —
they're missing or confusing *behaviour*, which only shows up when a real person tries to
use the thing for what it's actually for.

The pattern that repeats, over and over, across this whole project:

1. Someone notices something's off, in plain, ordinary words.
2. Before assuming "I need to add a new button," actually go look at *why* the current
   behaviour is what it is (more than once here, the honest answer turned out to be
   "there's leftover code that looks like it should be doing this, and quietly isn't").
3. Make the smallest fix that's still honest about any trade-off it makes (ending a match
   early stays *possible*, it just now asks first).
4. Actually go click through the fix in a real browser before calling it done — not just
   trust that the code "should" work.
5. Write down what happened and why, so the next person (including future-you) doesn't
   have to re-discover the same reasoning from scratch.

That loop — *notice → understand why, not just what → fix honestly → verify for real →
write it down* — is really the one big transferable idea underneath this entire document.
Everything else here is what that loop looks like when the thing you're building happens to
be a football xG app.

---

## If you want to build something like this yourself

A short, honest checklist, in the order this project actually did it:

1. **Write down what you're building and why**, in plain language, before any code.
2. **Get real example data**, and be picky about it — more data isn't automatically better
   data.
3. **Always test on examples the model never saw while learning**, and be careful that your
   "unseen" examples aren't secretly still similar to what it learned from.
4. **Check that confidence numbers are trustworthy**, not just that rankings are roughly
   right.
5. **Decide up front what happens when information is missing** — don't bolt that on later.
6. **Export the trained model into a format the actual app can run**, and verify the export
   matches the original before trusting it.
7. **Keep your calculation logic in small, pure, easily-testable pieces**, separate from
   anything that draws pixels on a screen.
8. **Whenever the same logic exists in two places** (two languages, two files, whatever),
   write an automatic check that they agree — don't rely on memory.
9. **Test in the real environment it'll actually run in**, not only inside your automated
   tests — they catch different classes of bugs.
10. **Turn design opinions into checkable facts** wherever you can.
11. **Ship it somewhere a real person can open it**, and think honestly about what happens
    when you update it later.
12. **Keep listening once it's "live"** — and when something's reported, go find out *why*
    it's true before deciding how to fix it.

None of this requires being an expert going in. It requires being willing to write the plan
down, check your own work with real numbers instead of vibes, and actually go look at the
real thing running before believing it's finished.
