use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, ParseError, Parser, ParserInput, ParserState,
    QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser, StyleSheetParser, Token,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{storage::project, CanvasContent, CanvasNode, Extensions};
use crate::store::SessionIndexItem;

const FILE_LIMIT: u64 = 2 * 1024 * 1024;
const SCAN_LIMIT: u64 = 24 * 1024 * 1024;
const TOKEN_LIMIT: usize = 3_000;
const REPLY_LIMIT: usize = 768 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasTokenSource {
    pub project_path: String,
    pub cwd: String,
    pub worktree: Option<String>,
}

impl CanvasTokenSource {
    pub(crate) fn session(session: &SessionIndexItem) -> Self {
        Self {
            project_path: session.project_path.clone(),
            cwd: session.cwd.clone(),
            worktree: session
                .worktree_name
                .clone()
                .filter(|_| !session.worktree_removed),
        }
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasProjectToken {
    name: String,
    value: String,
    file: String,
    line: u32,
    scope: Vec<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasTokenCatalog {
    source: CanvasTokenSource,
    tokens: Vec<CanvasProjectToken>,
    incomplete: bool,
}

/// Read the same source checkout that the selected session uses.
pub async fn canvas_project_tokens(
    project_path: String,
    session_id: Option<String>,
) -> Result<CanvasTokenCatalog, String> {
    let source = if let Some(id) = session_id {
        let session = crate::store::get_session_index_item(&id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("The Canvas session is no longer available.")?;
        if session.project_path != project_path
            && project(&session.project_path).await?.key != project(&project_path).await?.key
        {
            return Err("Choose a session in the Canvas project.".into());
        }
        CanvasTokenSource::session(&session)
    } else {
        let project = crate::projects::list_projects()
            .await
            .map_err(|e| format!("{e:?}"))?
            .into_iter()
            .find(|project| project.path == project_path)
            .ok_or("Choose an attached project to read its tokens.")?;
        CanvasTokenSource {
            project_path: project.path.clone(),
            cwd: project.path,
            worktree: None,
        }
    };
    catalog(source).await
}

pub(super) async fn catalog(source: CanvasTokenSource) -> Result<CanvasTokenCatalog, String> {
    tokio::task::spawn_blocking(move || scan(source))
        .await
        .map_err(|e| e.to_string())?
}

fn scan(mut source: CanvasTokenSource) -> Result<CanvasTokenCatalog, String> {
    let root = PathBuf::from(&source.cwd)
        .canonicalize()
        .map_err(|e| format!("Cannot read CSS in {}. {e}", source.cwd))?;
    if !root.is_dir() {
        return Err("The token source must be a directory.".into());
    }
    source.cwd = root.to_string_lossy().into_owned();
    let mut builder = ignore::WalkBuilder::new(&root);
    builder
        .require_git(false)
        .sort_by_file_path(Ord::cmp)
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_some_and(|kind| kind.is_dir())
                || !matches!(
                    entry.file_name().to_str(),
                    Some("node_modules" | "target" | "dist" | "vendor")
                )
        });
    let mut catalog = CanvasTokenCatalog {
        source,
        tokens: vec![],
        incomplete: false,
    };
    let mut scanned = 0;
    let mut remaining = REPLY_LIMIT;
    for (index, entry) in builder.build().enumerate() {
        if index >= 50_000
            || scanned >= SCAN_LIMIT
            || remaining == 0
            || catalog.tokens.len() >= TOKEN_LIMIT
        {
            catalog.incomplete = true;
            break;
        }
        let Ok(entry) = entry else {
            catalog.incomplete = true;
            continue;
        };
        let path = entry.path();
        if !entry.file_type().is_some_and(|kind| kind.is_file())
            || path.extension().and_then(|ext| ext.to_str()) != Some("css")
        {
            continue;
        }
        let max = FILE_LIMIT.min(SCAN_LIMIT - scanned);
        let mut css = String::new();
        if open_css(&root, path)
            .and_then(|file| file.take(max + 1).read_to_string(&mut css))
            .is_err()
            || css.len() as u64 > max
        {
            catalog.incomplete = true;
            continue;
        }
        scanned += css.len() as u64;
        let file = path
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy();
        let mut parser = Declarations {
            file: &file,
            scope: vec![],
            catalog: &mut catalog,
            remaining: &mut remaining,
        };
        let mut input = ParserInput::new(&css);
        let mut input = Parser::new(&mut input);
        for _ in StyleSheetParser::new(&mut input, &mut parser) {}
    }
    catalog
        .tokens
        .sort_by(|a, b| (&a.name, &a.file, a.line).cmp(&(&b.name, &b.file, b.line)));
    Ok(catalog)
}

fn open_css(root: &Path, path: &Path) -> std::io::Result<File> {
    if path.canonicalize()? != path || !path.starts_with(root) {
        return Err(std::io::Error::other(
            "CSS source moved outside the checkout",
        ));
    }
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("CSS source is not a regular file"));
    }
    Ok(file)
}

struct Declarations<'a> {
    file: &'a str,
    scope: Vec<String>,
    catalog: &'a mut CanvasTokenCatalog,
    remaining: &'a mut usize,
}

fn consume<'i>(input: &mut Parser<'i, '_>) -> &'i str {
    let start = input.position();
    while input.next_including_whitespace_and_comments().is_ok() {}
    input.slice_from(start).trim()
}

impl Declarations<'_> {
    fn block(&mut self, scope: String, input: &mut Parser<'_, '_>) {
        if self.scope.len() == 12 || scope.len() > 512 {
            self.catalog.incomplete = true;
            return;
        }
        self.scope.push(scope);
        for _ in RuleBodyParser::new(input, self) {}
        self.scope.pop();
    }
}

impl<'i> DeclarationParser<'i> for Declarations<'_> {
    type Declaration = ();
    type Error = ();

    fn parse_value<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
        start: &ParserState,
    ) -> Result<(), ParseError<'i, ()>> {
        let value = consume(input);
        if !name.starts_with("--") || name.len() <= 2 {
            return Ok(());
        }
        if name.len() > 256 || value.len() > 2048 || self.catalog.tokens.len() >= TOKEN_LIMIT {
            self.catalog.incomplete = true;
            return Ok(());
        }
        let token = CanvasProjectToken {
            name: name.to_string(),
            value: value.into(),
            file: self.file.into(),
            line: start.source_location().line + 1,
            scope: self.scope.clone(),
        };
        let size = serde_json::to_vec(&token)
            .map_err(|_| input.new_custom_error(()))?
            .len()
            + 1;
        if *self.remaining < size {
            self.catalog.incomplete = true;
            *self.remaining = 0;
        } else {
            *self.remaining -= size;
            self.catalog.tokens.push(token);
        }
        Ok(())
    }
}

impl<'i> AtRuleParser<'i> for Declarations<'_> {
    type Prelude = Option<String>;
    type AtRule = ();
    type Error = ();

    fn parse_prelude<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
    ) -> Result<Self::Prelude, ParseError<'i, ()>> {
        let prelude = consume(input);
        let name = name.to_ascii_lowercase();
        Ok(matches!(
            name.as_str(),
            "theme" | "layer" | "media" | "supports" | "container" | "scope" | "starting-style"
        )
        .then(|| format!("@{name} {prelude}").trim_end().to_string()))
    }

    fn parse_block<'t>(
        &mut self,
        scope: Self::Prelude,
        _: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<(), ParseError<'i, ()>> {
        if let Some(scope) = scope {
            self.block(scope, input);
        }
        Ok(())
    }
}

impl<'i> QualifiedRuleParser<'i> for Declarations<'_> {
    type Prelude = String;
    type QualifiedRule = ();
    type Error = ();

    fn parse_prelude<'t>(
        &mut self,
        input: &mut Parser<'i, 't>,
    ) -> Result<String, ParseError<'i, ()>> {
        Ok(consume(input).into())
    }

    fn parse_block<'t>(
        &mut self,
        scope: String,
        _: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<(), ParseError<'i, ()>> {
        self.block(scope, input);
        Ok(())
    }
}

impl<'i> RuleBodyItemParser<'i, (), ()> for Declarations<'_> {
    fn parse_declarations(&self) -> bool {
        true
    }
    fn parse_qualified(&self) -> bool {
        true
    }
}

fn used_names(value: &str) -> Vec<String> {
    fn walk<'i>(
        input: &mut Parser<'i, '_>,
        names: &mut BTreeSet<String>,
        depth: u8,
    ) -> Result<(), ParseError<'i, ()>> {
        while let Ok(token) = input.next() {
            let var = matches!(token, Token::Function(name) if name.eq_ignore_ascii_case("var"));
            if depth < 16 && matches!(token, Token::Function(_) | Token::ParenthesisBlock) {
                let _ = input.parse_nested_block(|input| {
                    if var {
                        if let Ok(name) = input.expect_ident() {
                            if name.starts_with("--") && name.len() > 2 {
                                names.insert(name.to_string());
                            }
                        }
                    }
                    walk(input, names, depth + 1)
                });
            }
        }
        Ok(())
    }
    let mut input = ParserInput::new(value);
    let mut names = BTreeSet::new();
    let _ = walk(&mut Parser::new(&mut input), &mut names, 0);
    names.into_iter().collect()
}

#[derive(Serialize)]
struct PropertyLink<'a> {
    names: Vec<String>,
    value: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LayerLinks<'a> {
    node_id: &'a str,
    properties: BTreeMap<&'a str, PropertyLink<'a>>,
}

/// Carry proven names beside stored values without changing the frame's rendered CSS.
pub(super) fn links(nodes: &[CanvasNode]) -> Vec<LayerLinks<'_>> {
    let mut result = Vec::new();
    for node in nodes {
        let CanvasNode::Element {
            id,
            styles,
            children,
            extra,
            ..
        } = node
        else {
            continue;
        };
        let capture = extra
            .get("tokenReferences")
            .and_then(serde_json::Value::as_object);
        let referenced: BTreeMap<_, _> = styles
            .iter()
            .filter_map(|(property, value)| {
                let captured = capture.and_then(|refs| refs.get(property));
                let names: Vec<String> = captured
                    .and_then(|names| serde_json::from_value(names.clone()).ok())
                    .unwrap_or_else(|| used_names(value));
                (!names.is_empty()).then(|| (property.as_str(), PropertyLink { names, value }))
            })
            .collect();
        if !referenced.is_empty() {
            result.push(LayerLinks {
                node_id: id,
                properties: referenced,
            });
        }
        result.extend(links(children));
    }
    result
}

pub(super) fn names(nodes: &[CanvasNode]) -> Vec<String> {
    links(nodes)
        .into_iter()
        .flat_map(|layer| layer.properties.into_values())
        .flat_map(|link| link.names)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub(super) fn source(content: &CanvasContent) -> Option<&serde_json::Value> {
    content.extra.get("tokenSource")
}

pub(super) fn clear_reference(extra: &mut Extensions, property: &str) {
    if let Some(refs) = extra
        .get_mut("tokenReferences")
        .and_then(serde_json::Value::as_object_mut)
    {
        refs.remove(property);
        if refs.is_empty() {
            extra.remove("tokenReferences");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn catalog_reads_the_checkout_again_and_keeps_conditional_declarations() {
        struct Fixture(PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let fixture =
            Fixture(std::env::temp_dir().join(format!("carbon-tokens-{}", uuid::Uuid::new_v4())));
        let project = fixture.0.join("project");
        let worktree = fixture.0.join("worktree");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(worktree.join("node_modules")).unwrap();
        fs::write(worktree.join(".gitignore"), "generated.css\n").unwrap();
        fs::write(worktree.join("generated.css"), ":root { --generated: red }").unwrap();
        fs::write(
            worktree.join("node_modules/lib.css"),
            ":root { --dependency: blue }",
        )
        .unwrap();
        fs::write(worktree.join("theme.scss"), ":root { --sass-value: red }").unwrap();
        fs::write(
            project.join("theme.css"),
            ":root { --brand: orange; --main-only: 12px }",
        )
        .unwrap();
        let css = worktree.join("theme.css");
        fs::write(
            &css,
            r#"
@import "tailwindcss";
/* :root { --comment: none } */
:root { --brand: red; --space: calc(2 * var(--unit, 4px)); content: "--fake: yes;"; }
@theme inline { --color-brand: var(--brand); --color-*: initial; }
@media (prefers-color-scheme: dark) { [data-theme="dark"] { --brand: oklch(0.5 0.2 20); } }
"#,
        )
        .unwrap();
        let source = CanvasTokenSource {
            project_path: project.to_string_lossy().into(),
            cwd: worktree.to_string_lossy().into(),
            worktree: Some("experiment".into()),
        };
        let first = scan(source.clone()).unwrap();
        assert!(!first.incomplete);
        assert_eq!(
            first.source.cwd,
            worktree.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(
            first
                .tokens
                .iter()
                .map(|t| t.name.as_str())
                .collect::<Vec<_>>(),
            ["--brand", "--brand", "--color-brand", "--space"]
        );
        assert_eq!(first.tokens[0].value, "red");
        assert_eq!(first.tokens[1].line, 6);
        assert_eq!(
            first.tokens[1].scope,
            [
                "@media (prefers-color-scheme: dark)",
                "[data-theme=\"dark\"]"
            ]
        );
        assert_eq!(first.tokens[2].value, "var(--brand)");
        assert_eq!(first.tokens[2].scope, ["@theme inline"]);
        assert_eq!(first.tokens[3].value, "calc(2 * var(--unit, 4px))");
        fs::write(&css, ":root { --space: 8px }").unwrap();
        let second = scan(source).unwrap();
        assert_eq!(second.tokens.len(), 1);
        assert_eq!(second.tokens[0].value, "8px");
    }

    #[test]
    fn authored_references_do_not_match_strings_or_literal_values() {
        assert_eq!(
            used_names("calc(var(--spacing) * 2) var(--brand, var(--fallback))"),
            ["--brand", "--fallback", "--spacing"]
        );
        assert!(used_names("\"var(--brand)\" /* var(--brand) */ rgb(0 0 0)").is_empty());
    }
}
