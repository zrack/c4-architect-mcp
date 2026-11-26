import Parser from "tree-sitter";
import TypeScriptGrammar from "tree-sitter-typescript";
import ts from "typescript";
import type { GraphDiagnostic, SourceEvidence } from "../model/graph.js";

export type DependencyKind = "import" | "type-import" | "re-export" | "dynamic-import" | "require";
export interface DependencyFact {
  specifier: string;
  kind: DependencyKind;
  typeOnly: boolean;
  resolutionMode?: "require";
  evidence: SourceEvidence;
}
export interface SourceFacts {
  dependencies: DependencyFact[];
  exports: string[];
  exportEvidence: SourceEvidence[];
  diagnostics: GraphDiagnostic[];
  parseStatus: "complete" | "partial";
}

function literalValue(node: Parser.SyntaxNode | null): string | undefined {
  if (!node || !["string", "template_string"].includes(node.type)) return undefined;
  if (node.type === "template_string" && node.namedChildren.some(child => child.type === "template_substitution")) return undefined;
  // The compiler scanner decodes string escapes without evaluating source code.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, node.text);
  const token = scanner.scan();
  return token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ? scanner.getTokenValue() : undefined;
}

function hasKeyword(node: Parser.SyntaxNode, keyword: string): boolean {
  return node.children.some(child => child.type === keyword);
}

function allSpecifiersAreTypes(node: Parser.SyntaxNode, kind: "import" | "export"): boolean {
  const clause = node.namedChildren.find(child => child.type === `${kind}_clause`);
  if (!clause) return false;
  if (kind === "import" && clause.namedChildren.some(child => ["identifier", "namespace_import"].includes(child.type))) return false;
  const container = kind === "import" ? clause.namedChildren.find(child => child.type === "named_imports") : clause;
  const specifiers = container?.namedChildren.filter(child => child.type === `${kind}_specifier`) ?? [];
  return specifiers.length > 0 && specifiers.every(child => hasKeyword(child, "type"));
}

function recoverTypeStarExport(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (!node.hasError) return undefined;
  // The current native grammar recovers TypeScript 5's type-only star export
  // as a regular star export with a single ERROR for the `type` token. Match
  // that exact shape so unrelated syntax errors remain visible.
  const tokens = node.children.filter(child => child.type !== "comment");
  const [keyword, modifier, star, from, source, terminator] = tokens;
  if (tokens.length < 5 || tokens.length > 6 || keyword.type !== "export"
    || modifier.type !== "ERROR" || modifier.text !== "type"
    || !["*", "namespace_export"].includes(star.type) || star.hasError
    || from.type !== "from" || source.type !== "string" || source.hasError
    || (terminator && terminator.type !== ";")
    || tokens.some(token => token.isMissing)) return undefined;
  return modifier;
}

// A named re-export can be split into valid-looking statements by the native grammar
// when both the export clause and the contextual keyword "from" end their lines.
function looksLikeSplitExport(node: Parser.SyntaxNode) {
  if (node.type !== "export_statement" || node.childForFieldName("source")
    || !node.namedChildren.some(child => child.type === "export_clause") || hasKeyword(node, ";")) return false;
  let next = node.nextNamedSibling;
  while (next?.type === "comment") next = next.nextNamedSibling;
  return next?.type === "expression_statement" && next.firstNamedChild?.type === "identifier"
    && next.firstNamedChild.text === "from";
}

function reconcileNamedExports(original: ts.SourceFile, root: Parser.SyntaxNode) {
  const native = new Map(root.namedChildren.map(node => [node.startIndex, node]));
  const ends = new Map<number, number>();
  const chunks: string[] = [];
  let offset = 0;
  let diagnostics: readonly ts.DiagnosticWithLocation[] | undefined;
  for (const declaration of original.statements) {
    if (!ts.isExportDeclaration(declaration) || !declaration.exportClause || !ts.isNamedExports(declaration.exportClause)
      || !declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const start = declaration.getStart(original);
    const source = declaration.moduleSpecifier;
    const sourceStart = source.getStart(original);
    const node = native.get(start);
    if (node?.type === "export_statement" && !node.hasError && node.childForFieldName("source")?.startIndex === sourceStart) continue;

    // Verify this declaration with the compiler before reconciling a grammar disagreement.
    // Invalid syntax elsewhere in the file must still be reported by the normal parser.
    if (!diagnostics) {
      const options = { noResolve: true, noLib: true, types: [] };
      const host = ts.createCompilerHost(options);
      host.getSourceFile = name => name === original.fileName ? original : undefined;
      diagnostics = ts.createProgram([original.fileName], options, host).getSyntacticDiagnostics(original);
    }
    if (diagnostics.some(item => item.start >= start && item.start <= declaration.end)) continue;

    // Supply the native parser with the equivalent supported spelling. Keep UTF-16
    // offsets identical and derive line/column evidence from the original text.
    const clauseEnd = declaration.exportClause.end;
    chunks.push(original.text.slice(offset, clauseEnd), "from".padEnd(sourceStart - clauseEnd), original.text.slice(sourceStart, source.end));
    const attributeEnd = declaration.attributes?.end ?? source.end;
    chunks.push(" ".repeat(attributeEnd - source.end));
    offset = attributeEnd;
    ends.set(start, declaration.end);
  }
  if (chunks.length === 0) return;
  chunks.push(original.text.slice(offset));
  return { text: chunks.join(""), ends };
}

function inTypeContext(node: Parser.SyntaxNode): boolean {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (["type_alias_declaration", "type_annotation", "type_query", "type_arguments", "interface_declaration"].includes(ancestor.type)) return true;
    if (["expression_statement", "statement_block", "program"].includes(ancestor.type)) break;
  }
  return false;
}

function bindingNames(node: Parser.SyntaxNode): string[] {
  if (["identifier", "type_identifier", "shorthand_property_identifier_pattern"].includes(node.type)) return [node.text];
  if (node.type === "pair_pattern") {
    const value = node.childForFieldName("value");
    return value ? bindingNames(value) : [];
  }
  if (node.type === "assignment_pattern") {
    const left = node.childForFieldName("left");
    return left ? bindingNames(left) : [];
  }
  return node.namedChildren.flatMap(bindingNames);
}

/** Observe dependency syntax. No source, package script, or imported module is executed. */
export function extractSourceFacts(sourceCode: string, filePath: string, isTsx = false): SourceFacts {
  const parser = new Parser();
  parser.setLanguage(isTsx ? TypeScriptGrammar.tsx : TypeScriptGrammar.typescript);
  // Supply UTF-16 chunks that fit in the native input buffer, including its terminator.
  function parse(text: string) {
    return parser.parse(offset => {
      const end = offset + 16 * 1024;
      const last = text.charCodeAt(end - 1);
      return text.slice(offset, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
    });
  }
  let tree = parse(sourceCode);
  let original: ts.SourceFile | undefined;
  let exportEnds: Map<number, number> | undefined;
  const compilerSource = () => original ??= ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, false, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (sourceCode.includes("export") && sourceCode.includes("from")
    && (tree.rootNode.hasError || tree.rootNode.namedChildren.some(looksLikeSplitExport))) {
    const reconciled = reconcileNamedExports(compilerSource(), tree.rootNode);
    if (reconciled) {
      tree = parse(reconciled.text);
      exportEnds = reconciled.ends;
    }
  }
  // Native points count LF only. TypeScript also treats CR, U+2028 and U+2029 as line breaks.
  if (/[\u2028\u2029]|\r(?!\n)/.test(sourceCode)) compilerSource();
  function position(offset: number, native: Parser.Point) {
    const point = original?.getLineAndCharacterOfPosition(offset);
    return point ? { line: point.line + 1, column: point.character + 1 } : { line: native.row + 1, column: native.column + 1 };
  }
  function location(node: Parser.SyntaxNode, path: string, kind: string, specifier?: string, typeOnly?: boolean): SourceEvidence {
    const start = position(node.startIndex, node.startPosition);
    const endOffset = kind === "export" ? exportEnds?.get(node.startIndex) : undefined;
    const end = position(endOffset ?? node.endIndex, node.endPosition);
    return { path, ...start, endLine: end.line, endColumn: end.column, kind,
      ...(specifier === undefined ? {} : { specifier }), ...(typeOnly === undefined ? {} : { typeOnly }) };
  }
  const dependencies: DependencyFact[] = [], diagnostics: GraphDiagnostic[] = [];
  const exports = new Set<string>();
  const exportEvidence: SourceEvidence[] = [];
  const seen = new Set<string>();
  let syntaxErrors = 0;
  let recoveredTypeStars = 0;
  function addDependency(source: Parser.SyntaxNode | null, node: Parser.SyntaxNode, kind: DependencyKind, typeOnly: boolean, resolutionMode?: "require") {
    const specifier = literalValue(source);
    if (specifier === undefined) {
      diagnostics.push({ code: "NON_LITERAL_DEPENDENCY", severity: "warning", path: filePath,
        ...position(node.startIndex, node.startPosition),
        message: `A ${kind} uses a computed module specifier; no dependency target was guessed.` });
      return;
    }
    const key = `${node.startIndex}:${specifier}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    dependencies.push({ specifier, kind, typeOnly, ...(resolutionMode ? { resolutionMode } : {}), evidence: location(source ?? node, filePath, kind, specifier, typeOnly) });
  }
  function walk(node: Parser.SyntaxNode) {
    let recoveredModifier: Parser.SyntaxNode | undefined;
    if ((node.type === "ERROR" || node.isMissing) && syntaxErrors++ < 10) {
      diagnostics.push({ code: "PARSE_ERROR", severity: "error", path: filePath,
        ...position(node.startIndex, node.startPosition),
        message: "Tree-sitter found invalid or incomplete syntax; extracted dependencies may be partial." });
    }
    if (node.type === "import_statement") {
      const requireClause = node.namedChildren.find(child => child.type === "import_require_clause");
      const source = node.childForFieldName("source") ?? requireClause?.childForFieldName("source") ?? null;
      const typeOnly = hasKeyword(node, "type") || allSpecifiersAreTypes(node, "import");
      addDependency(source, node, typeOnly ? "type-import" : requireClause ? "require" : "import", typeOnly, requireClause ? "require" : undefined);
    } else if (node.type === "export_statement") {
      const source = node.childForFieldName("source");
      recoveredModifier = recoverTypeStarExport(node);
      const typeOnly = Boolean(recoveredModifier) || hasKeyword(node, "type") || allSpecifiersAreTypes(node, "export");
      if (source) addDependency(source, node, "re-export", typeOnly);
      // Namespace member exports do not become exports of the containing file.
      if (node.parent?.type === "program") {
        exportEvidence.push(location(node, filePath, "export", literalValue(source), typeOnly));
        if (hasKeyword(node, "default")) exports.add("default");
        if (hasKeyword(node, "=")) exports.add("export=");
        const declaration = node.childForFieldName("declaration");
        if (declaration) {
          const name = declaration.childForFieldName("name");
          if (name) exports.add(`${declaration.type.replace(/_declaration$/, "")}:${name.text}`);
          if (["lexical_declaration", "variable_declaration"].includes(declaration.type)) {
            for (const variable of declaration.namedChildren.filter(child => child.type === "variable_declarator")) {
              const binding = variable.childForFieldName("name");
              if (binding) bindingNames(binding).forEach(name => exports.add(`variable:${name}`));
            }
          }
        }
        const clause = node.namedChildren.find(child => child.type === "export_clause");
        for (const specifier of clause?.namedChildren.filter(child => child.type === "export_specifier") ?? []) {
          const name = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name");
          if (name) exports.add(`named:${literalValue(name) ?? name.text}`);
        }
        const namespace = node.namedChildren.find(child => child.type === "namespace_export");
        if (namespace) exports.add(`namespace:${namespace.namedChildren.at(-1)?.text ?? "*"}`);
        else if (source && hasKeyword(node, "*")) exports.add(`re-export:*:${literalValue(source) ?? "unknown"}`);
      }
    } else if (node.type === "call_expression") {
      const callee = node.childForFieldName("function");
      const dynamic = callee?.type === "import";
      const required = callee?.type === "identifier" && callee.text === "require";
      if (dynamic || required) {
        const typeOnly = dynamic && inTypeContext(node);
        const source = node.childForFieldName("arguments")?.namedChildren[0] ?? null;
        addDependency(source, node, typeOnly ? "type-import" : dynamic ? "dynamic-import" : "require", typeOnly);
      }
    }
    for (const child of node.hasError ? node.children : node.namedChildren) {
      if (recoveredModifier && child.id === recoveredModifier.id) recoveredTypeStars++;
      else walk(child);
    }
  }
  walk(tree.rootNode);
  if (tree.rootNode.hasError && syntaxErrors === 0 && recoveredTypeStars === 0) {
    syntaxErrors++;
    diagnostics.push({ code: "PARSE_ERROR", severity: "error", path: filePath, line: 1, column: 1,
      message: "Tree-sitter found invalid or incomplete syntax; extracted dependencies may be partial." });
  }
  return { dependencies, exports: [...exports].sort(), exportEvidence, diagnostics, parseStatus: syntaxErrors > 0 ? "partial" : "complete" };
}
