//! Project-owned editable designs, independent of sessions and Git history.

mod agent;
mod assets;
mod commands;
mod model;
mod nodes;
mod render;
mod storage;
mod undo;
mod watch;

pub use agent::*;

pub use assets::{CanvasAssetData, CanvasAssetProgress, CanvasAssetUpload};
pub use commands::*;
pub use model::*;
pub use undo::CanvasUndoState;
pub use watch::start;

#[cfg(test)]
mod tests;
