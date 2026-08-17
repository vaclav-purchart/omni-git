/**
 * Props for every free-text field in the app.
 *
 * macOS turns autocorrect, autocapitalisation and smart substitutions on by
 * default in a WKWebView, which is actively wrong for what gets typed here:
 * branch names, globs, file paths, git commands — and commit messages, where
 * "won't" silently becoming a curly-quoted "won’t", or a lowercase first word
 * being capitalised, ends up in permanent history.
 *
 * Spellcheck is off for the same reason: a commit message is full of identifiers
 * and the red underlines are noise rather than signal.
 *
 * Spread onto the element rather than repeated field by field, so a new input
 * can't quietly miss one of the four.
 */
export const NO_AUTOCORRECT = {
	spellCheck: false,
	autoCorrect: "off",
	autoCapitalize: "off",
	autoComplete: "off",
} as const
