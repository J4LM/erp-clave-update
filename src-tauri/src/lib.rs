mod commands;
mod compare;
mod db;
mod error;
mod exclusions;
mod net;
mod profiles;
mod secrets;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("erp-clave-update.db");
            app.manage(db::Database::open(&path)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_setting,
            commands::set_setting,
            commands::list_profiles,
            commands::get_profile,
            commands::create_profile,
            commands::update_profile,
            commands::delete_profile,
            commands::create_server,
            commands::update_server,
            commands::delete_server,
            commands::test_server,
            commands::add_exclusion,
            commands::delete_exclusion,
            commands::preview_exclusions,
            commands::compare_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
