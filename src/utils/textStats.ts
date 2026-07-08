/** Approximate size of text content in KB, formatted to one decimal (e.g. "3.2"). */
export function charSizeKb(text: string | null | undefined): string {
  return ((text?.length ?? 0) / 1024).toFixed(1)
}

/** Number of lines in text content (empty/nullish counts as a single line). */
export function countLines(text: string | null | undefined): number {
  return (text ?? '').split('\n').length
}
