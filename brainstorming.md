# Cozy Focus Pet — brainstorming

A small, local-first desktop companion for focus sessions and real breaks. A quiet dog or other pet stays visible while I work and changes state as the session progresses.

## Ideas to explore

- A compact, click-through pet overlay that stays out of the way.
- Customizable focus and break timers, including Pomodoro cycles.
- Gentle cues to step away, followed by a cue when a break ends.
- Distinguish keyboard/mouse inactivity from an intentional break; treat screen lock or sleep as stronger evidence of being away.
- Optionally classify the foreground app using a user-controlled allowlist or distraction list. Activity alone cannot determine whether I am focused.
- Keep data on the computer. Start with the least intrusive system signals and avoid capturing typed text or screen contents.
- Make the pet pleasant to have around even when no timer is running.

## Open questions

- Target platform first: macOS only, or also Windows?
- Should a break timer begin automatically when I step away, or only when I choose “Take break”?
- How should the app notify me when a break ends if I am away from the computer?
- What, if anything, should earn pet customization or progress?

## References

- [Clippy](https://github.com/buildingjoshbetter/Clippy) — MIT; macOS pet overlay, Pomodoro timer, idle behavior, and stretch reminders. Review its input-monitoring approach before reusing it.
- [OpenDesktopPets](https://github.com/bangadam/OpenDesktopPets) — MIT; small, local macOS dog/cat overlay in Swift.
- [Stretchly](https://github.com/hovancik/stretchly) — BSD-2-Clause; cross-platform break scheduling and idle-aware breaks.
- [Desktop Pet Engine](https://github.com/InsiderX-Pro/desktop-pet-engine) — Apache-2.0; native macOS pet rendering and asset pipeline. Check the separate media restrictions.
