/// Reads this desktop's fonts, even when the selected session runs elsewhere.
#[tauri::command]
pub async fn list_font_families(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let mtm = objc2::MainThreadMarker::new().expect("AppKit runs on the main thread");
            let manager = objc2_app_kit::NSFontManager::sharedFontManager(mtm);
            let mut families: Vec<String> = manager
                .availableFontFamilies()
                .iter()
                .map(|name| name.to_string())
                .filter(|name| !name.is_empty() && !name.starts_with('.'))
                .collect();
            families.sort_unstable_by_key(|name| name.to_lowercase());
            families.dedup();
            let _ = send.send(families);
        })
        .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Installed fonts are available in the macOS app.".into())
    }
}
