# Rubik Timer — TODO

## High value
- [ ] Scramble generator — WCA-style random scramble shown above the timer, regenerated after each save/reset
- [ ] +2 penalty — second penalty tier alongside DNF; adds 2s to the solve, stays a valid number in averages (vs. DNF which is excluded/worst-case)

## Usability
- [ ] Best/worst highlighting in the saved list (mark current best single, and which entries get trimmed from each average)
- [ ] Overall stats: best single, session mean, solve count
- [ ] Tap-to-start on mobile/touch (spacebar hold-to-start doesn't exist on phones)
- [ ] Manual light/dark toggle (currently only follows OS `prefers-color-scheme`)

## Structural
- [ ] Sessions / multiple cube events (3x3, 2x2, OH, etc.), each with its own saved times
- [ ] PWA support (manifest + service worker) — installable, works offline
- [ ] Export/import saved times as JSON for backup or transfer between browsers
