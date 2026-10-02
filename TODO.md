# Rubik Timer — TODO

## High value
- [ ] Scramble generator — WCA-style random scramble shown above the timer, regenerated after each save/reset
- [x] 15s inspection timer — countdown before the solve; auto +2 if started at 15–17s, DNF past 17s (WCA rules)
- [x] +2 penalty — only after the inspection timer exists; adds 2s to the solve, stays a valid number in averages (vs. DNF which is excluded/worst-case)

## Usability
- [x] Best/worst highlighting in the saved list (mark current best single, and which entries get trimmed from each average)
- [ ] Tap-to-start on mobile/touch (spacebar hold-to-start doesn't exist on phones)
- [ ] Manual light/dark toggle (currently only follows OS `prefers-color-scheme`)