// Single source of truth for the coclaude version. The release workflow
// overwrites this file's literal before `bun build --compile` so the
// compiled binary reports the tagged version. Running from source shows
// the dev value here.
export const VERSION = "0.1.1";
