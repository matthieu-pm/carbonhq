//! Project-owned editable designs, independent of sessions and Git history.

mod assets;
mod commands;
mod model;
mod storage;
mod watch;

pub use assets::{CanvasAssetData, CanvasAssetProgress, CanvasAssetUpload};
pub use commands::*;
pub use model::*;
pub use watch::start;

#[cfg(test)]
mod tests;
