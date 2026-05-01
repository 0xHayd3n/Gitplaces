// Cleans GitHub release/PR markdown for display in the activity modal:
//   1. Removes wholesale "Mentions" / "Contributors" / "Thanks" sections — a
//      heading-delimited block of nothing but @user names is meaningless once
//      the mentions are stripped.
//   2. Removes GitHub mentions (@user, @org/team) and issue/PR references
//      (#1234), in both bare forms and the markdown-linked forms GitHub
//      auto-generates ([#123](.../pull/123), [@user](github.com/user)).
//   3. Cleans up the syntactic debris those strips leave behind: empty bold/
//      italic/strike wrappers, empty parens, orphan commas, double whitespace,
//      space-before-punctuation, and trailing horizontal rules left dangling
//      where a removed section used to be.
// ReadmeRenderer is left unchanged; this is purely a preprocessor.
export function stripMentionsAndRefs(md: string): string {
  return md
    // Drop "Mentions" / "Contributors" / "Thanks" / "Acknowledgements" sections
    // entirely — heading line plus content until the next heading or end. The
    // optional Special/Big/All/Huge/Many prefix catches "Special Thanks" etc.
    // The trailing `(?:(?!^#…).)*` greedily eats the body using a per-character
    // negative lookahead instead of `[\s\S]*?(?=…|\s*$)`, because the latter
    // misfires on the blank line that typically separates a heading from its
    // body — `\s*$` matches there and the body never gets consumed.
    .replace(
      /^#{1,6}[ \t]+(?:(?:special|big|all|huge|many)[ \t]+)?(?:mentions?|contributors?|thanks|acknowledg(?:e?ments?))[ \t!.:]*\r?\n(?:(?!^#{1,6}[ \t]+).)*/gims,
      '',
    )
    // Markdown links to GitHub issues/PRs — strip the whole link.
    .replace(/\[[^\]]*\]\(https?:\/\/github\.com\/[^/)]+\/[^/)]+\/(?:issues|pull)\/\d+\)/g, '')
    // Markdown links to GitHub user profiles — strip the whole link.
    .replace(/\[@?[\w-]+\]\(https?:\/\/github\.com\/[\w-]+\/?\)/g, '')
    // Bare issue/PR refs. Lookbehind avoids stripping mid-token (e.g. URLs).
    .replace(/(?<![\w/])#\d+\b/g, '')
    // Bare mentions. Lookbehind avoids matching email addresses.
    .replace(/(?<![\w.])@[a-zA-Z0-9][a-zA-Z0-9-]*(?:\/[a-zA-Z0-9._-]+)?/g, '')
    // Empty inline formatting wrappers left behind (e.g. "**@user**" → "****").
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/__\s*__/g, '')
    .replace(/~~\s*~~/g, '')
    .replace(/`\s*`/g, '')
    // Empty parens left behind (e.g. "(, , , )").
    .replace(/\(\s*[,\s]*\)/g, '')
    // Orphan leading comma after open paren.
    .replace(/\(\s*,\s*/g, '(')
    // Orphan trailing comma before close paren.
    .replace(/\s*,\s*\)/g, ')')
    // Doubled commas.
    .replace(/,(?:\s*,)+/g, ',')
    // Collapse runs of horizontal whitespace (preserve newlines).
    .replace(/[ \t]+/g, ' ')
    // Strip whitespace orphaned before sentence punctuation by the removals above.
    .replace(/[ \t]+([.,!?])/g, '$1')
    // Trim trailing whitespace per line.
    .replace(/[ \t]+$/gm, '')
    // Trailing horizontal rules orphaned by the section removal at step 1.
    .replace(/(?:\r?\n+\s*(?:-{3,}|\*{3,}|_{3,})\s*)+\s*$/g, '')
}
