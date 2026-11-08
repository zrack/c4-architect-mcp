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

function location(node: Parser.SyntaxNode, filePath: string, kind: string, specifier?: string, typeOnly?: boolean): SourceEvidence {
  return { path: filePath, line: node.startPosition.row + 1, column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1, kind,
    ...(specifier === undefined ? {} : { specifier }), ...(typeOnly === undefined ? {} : { typeOnly }) };
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
  const tree = parser.parse(offset => {
    const end = offset + 16 * 1024;
    const last = sourceCode.charCodeAt(end - 1);
    // Keep surrogate pairs together at chunk boundaries.
    return sourceCode.slice(offset, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
  });
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
        line: node.startPosition.row + 1, column: node.startPosition.column + 1,
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
        line: node.startPosition.row + 1, column: node.startPosition.column + 1,
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
