use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub project: String,
    pub folder: String,
    pub canvas: Option<String>,
    pub revision: Option<String>,
    pub command: CanvasCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "group", content = "args", rename_all = "kebab-case")]
pub enum CanvasCommand {
    /// List attached projects that can own canvases.
    Projects,
    /// Attach the selected project to Carbon.
    Attach,
    /// List canvases and folders in the attached project.
    List {
        #[cfg_attr(feature = "clap", arg(long))]
        archived: bool,
    },
    /// Find canvases by name or folder.
    Search {
        query: String,
        #[cfg_attr(feature = "clap", arg(long))]
        archived: bool,
    },
    /// Create a canvas in the target folder.
    Create,
    /// Create a child folder.
    Folder { name: String },
    /// Move the target canvas into a folder.
    Move { destination: String },
    /// Archive the target canvas.
    Archive,
    /// Restore the target canvas to its original folder.
    Restore,
    /// Read the current document and its revision.
    Read,
    /// Undo the latest CLI document edit on this server.
    Undo,
    /// Reapply the last undone CLI edit.
    Redo,
    /// Show layer edits in the open frame before committing them together.
    Preview {
        /// Owning Carbon session. Defaults to the calling agent.
        #[cfg_attr(feature = "clap", arg(long))]
        session: Option<String>,
        #[cfg_attr(feature = "clap", command(subcommand))]
        action: PreviewAction,
    },
    /// Manage canvas pages.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Page(PageAction),
    /// Edit frames, rectangles, text, layout and typography.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Layer(LayerAction),
    /// Manage layer effects, images and gradient stops.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Effect(EffectAction),
    /// Manage theme tokens and their links.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Token(TokenAction),
    /// Draw or erase freehand markup.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Stroke(StrokeAction),
    /// Manage pinned comments.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Comment(CommentAction),
    /// Control the open Carbon desktop window.
    #[cfg_attr(feature = "clap", command(subcommand))]
    View(ViewAction),
    /// Control the active canvas conversation.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Chat(ChatAction),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", content = "args", rename_all = "kebab-case")]
pub enum PreviewAction {
    /// Read this session's draft, or the saved canvas before its first edit.
    Read,
    /// Preview a layer edit and return its layer ID.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Layer(LayerAction),
    /// Preview a layer effect.
    #[cfg_attr(feature = "clap", command(subcommand))]
    Effect(EffectAction),
    /// Commit all pending preview edits as one undoable change.
    Save,
    /// Discard this session's unsaved preview.
    Cancel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum PageAction {
    /// List pages.
    List,
    /// Create a page.
    Add { name: String },
    /// Rename a page.
    Rename { id: String, name: String },
    /// Set the page background and optional opacity, including token references.
    Paint {
        id: String,
        background: String,
        #[cfg_attr(feature = "clap", arg(long))]
        opacity: Option<String>,
    },
    /// Remove a page and its layers, retaining at least one page.
    Remove { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum LayerAction {
    /// List frame size presets.
    Presets,
    /// Apply a named size preset to a frame.
    Preset { id: String, name: String },
    /// List layers, optionally on one page.
    List {
        #[cfg_attr(feature = "clap", arg(long))]
        page: Option<String>,
    },
    /// Create a Frame, Rectangle or Text layer.
    Add {
        kind: String,
        page: String,
        #[cfg_attr(feature = "clap", arg(long))]
        parent: Option<String>,
        #[cfg_attr(feature = "clap", arg(long, allow_negative_numbers = true))]
        x: Option<f64>,
        #[cfg_attr(feature = "clap", arg(long, allow_negative_numbers = true))]
        y: Option<f64>,
        #[cfg_attr(feature = "clap", arg(long))]
        name: Option<String>,
    },
    /// Rename a layer.
    Rename { id: String, name: String },
    /// Set text content.
    Text { id: String, text: String },
    /// Position a layer in its parent.
    Move {
        id: String,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        x: f64,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        y: f64,
    },
    /// Move a layer by an offset.
    Nudge {
        id: String,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        dx: f64,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        dy: f64,
    },
    /// Set layer width and height using CSS lengths.
    Resize {
        id: String,
        width: String,
        height: String,
    },
    /// Place a layer inside a frame or at the page root.
    Parent { id: String, parent: Option<String> },
    /// Set one layout, typography or appearance property.
    Style {
        id: String,
        property: String,
        value: String,
    },
    /// Replace a selection color throughout a layer subtree.
    ReplaceColor {
        id: String,
        old: String,
        new: String,
    },
    /// Remove a layer and its descendants.
    Remove { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum EffectAction {
    /// List a layer's effects.
    List { layer: String },
    /// Add an effect at the front of the stack.
    Add { layer: String, kind: String },
    /// Set an effect field, including a token reference.
    Set {
        layer: String,
        id: String,
        field: String,
        value: String,
    },
    /// Use an image from the attached project for a fill.
    Image {
        layer: String,
        id: String,
        path: String,
    },
    /// Enable the effect.
    Enable { layer: String, id: String },
    /// Disable the effect.
    Disable { layer: String, id: String },
    /// Move an effect to a zero-based index.
    Move {
        layer: String,
        id: String,
        index: usize,
    },
    /// Remove an effect.
    Remove { layer: String, id: String },
    /// Add a gradient stop.
    AddStop {
        layer: String,
        id: String,
        color: String,
        at: String,
    },
    /// Edit a gradient stop.
    SetStop {
        layer: String,
        id: String,
        stop: String,
        color: String,
        at: String,
    },
    /// Remove a gradient stop.
    RemoveStop {
        layer: String,
        id: String,
        stop: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum TokenAction {
    /// List or search tokens.
    List {
        #[cfg_attr(feature = "clap", arg(long))]
        query: Option<String>,
    },
    /// Create a token.
    Add {
        kind: String,
        name: String,
        value: String,
    },
    /// Rename a token.
    Rename { id: String, name: String },
    /// Update a token and all linked values.
    Set { id: String, value: String },
    /// Copy a token.
    Duplicate { id: String },
    /// Link a token to a layer style property.
    Apply {
        id: String,
        layer: String,
        property: String,
    },
    /// Remove a token and retain the resolved values on linked elements.
    Remove { id: String },
    /// Import tokens from DESIGN.md in this or another attached project.
    Import {
        path: String,
        #[cfg_attr(feature = "clap", arg(long))]
        source_project: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum StrokeAction {
    /// List strokes on a page.
    List { page: String },
    /// Draw a stroke using a JSON array of [x,y] points.
    Draw { page: String, points: String },
    /// Erase one stroke.
    Erase { page: String, id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum CommentAction {
    /// List pinned comments on a page.
    List { page: String },
    /// Save a pinned comment.
    Add {
        page: String,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        x: f64,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        y: f64,
        text: String,
    },
    /// Edit a pinned comment.
    Edit {
        page: String,
        id: String,
        text: String,
    },
    /// Remove a pinned comment.
    Remove { page: String, id: String },
    /// Send a visible page pin with its snapshot to the active canvas conversation.
    Send { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum ViewAction {
    /// Search the visible Theme token list.
    TokenSearch { query: String },
    /// Open a token editor, or dismiss it when no ID is given.
    Token { id: Option<String> },
    /// Resize the sidebar or conversation panel in pixels.
    Width { panel: String, pixels: usize },
    /// Show every project's canvases.
    AllProjects,
    /// Refresh the library from disk.
    Refresh,
    /// Inspect the visible workspace, open tabs and current editor state.
    State,
    /// Open the library at the selected project and folder.
    Library {
        #[cfg_attr(feature = "clap", arg(long))]
        archived: bool,
    },
    /// Search the visible library.
    Search { query: String },
    /// Switch the library to grid or list.
    Layout { layout: String },
    /// Open or select the target canvas tab.
    Open,
    /// Close the target canvas tab.
    Close,
    /// Navigate to the previous location.
    Back,
    /// Navigate to the next location.
    Forward,
    /// Activate a canvas page.
    Page { id: String },
    /// Select a layer or clear the selection.
    Select { id: Option<String> },
    /// Choose Select, Hand, Frame, Rectangle, Text, Pen or Comment.
    Tool { tool: String },
    /// Switch to Design or Theme.
    Mode { mode: String },
    /// Set the viewport translation in pixels.
    Pan {
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        x: f64,
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        y: f64,
    },
    /// Zoom around the board center. One means 100 percent.
    Zoom {
        #[cfg_attr(feature = "clap", arg(allow_negative_numbers = true))]
        factor: f64,
    },
    /// Fit layers to the board.
    Fit,
    /// Show or hide inspector, sidebar, chat or pages.
    Panel { panel: String, visibility: String },
    /// Expand or collapse a layer.
    Tree { id: String, visibility: String },
    /// Undo an editor edit.
    Undo,
    /// Redo an editor edit.
    Redo,
    /// Flush pending editor changes.
    Save,
    /// Discard unsaved editor changes and reload the saved document.
    Reload,
    /// Resolve a save conflict using the editor's copy.
    KeepMine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "clap", derive(clap::Subcommand))]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum ChatAction {
    /// List conversations docked on the active canvas.
    List,
    /// Create a canvas conversation tab.
    New,
    /// Open an existing project conversation.
    Open { id: String },
    /// Select a docked conversation.
    Select { id: String },
    /// Close a secondary conversation tab.
    Close { id: String },
    /// Send a message to the active conversation.
    Send { text: String },
    /// Interrupt the active conversation.
    Stop,
}
