/** Keep authored text inside one DSL token and disable variable substitution. */
export function dslString(value = ""): string {
  const literal = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\$\{/g, "$\u200b{")
    // The tokenizer treats a quote after any backslash as escaped and
    // recognises a literal backslash-n pair as a newline.
    .replace(/\\(?=n|$)/g, "\\\u200b")
    .replace(/^\s*\{\s*$/, "{\u200b")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  return '"' + literal + '"';
}
