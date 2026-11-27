//! Reads a window's interface tree through Windows UI Automation for the semantic-target tool (ADR 0064). The result is
//! the raw shape `tools/mcp/src/ui-snapshot.mjs` filters and bounds again on the other side:
//! `{ role, name, protected, states, bounds: {x, y, width, height}, children }`.
//!
//! What it reads: the role, name, enabled/focus/off-screen state and bounding box of the elements under one window.
//! What it never reads: values, text contents or selections, and it never reads the name of a password field. It only
//! reads; it does not invoke, focus or change anything. Nothing calls it yet: no tool or channel exposes it.

use serde_json::{json, Value};

/// Bounds on one read, in the same spirit as the other side (that side cuts again).
pub const MAX_NODES: usize = 500;
pub const MAX_DEPTH: usize = 12;
pub const MAX_NAME: usize = 120;

/// The role word for a UI Automation control type id (50000 and up). Anything unknown is "unknown".
pub fn role_for(control_type: i32) -> &'static str {
    match control_type {
        50000 => "button",
        50001 => "calendar",
        50002 => "checkbox",
        50003 => "combobox",
        50004 => "edit",
        50005 => "link",
        50006 => "image",
        50007 => "listitem",
        50008 => "list",
        50009 => "menu",
        50010 => "menubar",
        50011 => "menuitem",
        50012 => "progressbar",
        50013 => "radiobutton",
        50014 => "scrollbar",
        50015 => "slider",
        50016 => "spinner",
        50017 => "statusbar",
        50018 => "tab",
        50019 => "tabitem",
        50020 => "text",
        50021 => "toolbar",
        50022 => "tooltip",
        50023 => "tree",
        50024 => "treeitem",
        50025 => "custom",
        50026 => "group",
        50027 => "thumb",
        50028 => "datagrid",
        50029 => "dataitem",
        50030 => "document",
        50031 => "splitbutton",
        50032 => "window",
        50033 => "pane",
        50034 => "header",
        50035 => "headeritem",
        50036 => "table",
        50037 => "titlebar",
        50038 => "separator",
        _ => "unknown",
    }
}

/// What UI Automation said about one element.
pub struct Facts<'a> {
    pub control_type: i32,
    pub name: &'a str,
    pub is_password: bool,
    pub enabled: bool,
    pub focused: bool,
    pub offscreen: bool,
    /// left, top, right, bottom
    pub rect: (i32, i32, i32, i32),
}

/// One element's raw node from what UI Automation said about it. A password field keeps its role and nothing else.
pub fn node(facts: &Facts, children: Vec<Value>) -> Value {
    let Facts {
        control_type,
        name,
        is_password,
        enabled,
        focused,
        offscreen,
        rect,
    } = *facts;
    let (left, top, right, bottom) = rect;
    let mut states = vec![if enabled { "enabled" } else { "disabled" }];
    if focused {
        states.push("focused");
    }
    if offscreen {
        states.push("offscreen");
    }
    let mut value = json!({
        "role": if is_password { "password" } else { role_for(control_type) },
        "protected": is_password,
        "states": states,
        "bounds": {
            "x": left,
            "y": top,
            "width": (right - left).max(0),
            "height": (bottom - top).max(0),
        },
        "children": children,
    });
    if !is_password && !name.is_empty() {
        value["name"] = Value::String(name.chars().take(MAX_NAME).collect());
    }
    value
}

#[cfg(windows)]
mod reader {
    use super::*;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker,
    };

    fn read_element(
        element: &IUIAutomationElement,
        walker: &IUIAutomationTreeWalker,
        depth: usize,
        count: &mut usize,
    ) -> windows::core::Result<Value> {
        *count += 1;
        // SAFETY: plain property reads on a live UI Automation element; nothing is invoked or changed.
        let (control_type, name, is_password, enabled, focused, offscreen, rect) = unsafe {
            (
                element.CurrentControlType()?.0,
                element
                    .CurrentName()
                    .map(|n| n.to_string())
                    .unwrap_or_default(),
                element
                    .CurrentIsPassword()
                    .map(|b| b.as_bool())
                    .unwrap_or(false),
                element
                    .CurrentIsEnabled()
                    .map(|b| b.as_bool())
                    .unwrap_or(true),
                element
                    .CurrentHasKeyboardFocus()
                    .map(|b| b.as_bool())
                    .unwrap_or(false),
                element
                    .CurrentIsOffscreen()
                    .map(|b| b.as_bool())
                    .unwrap_or(false),
                element
                    .CurrentBoundingRectangle()
                    .map(|r| (r.left, r.top, r.right, r.bottom))?,
            )
        };
        let mut children = Vec::new();
        if depth < MAX_DEPTH {
            // SAFETY: walking the control view of a live element.
            let mut next = unsafe { walker.GetFirstChildElement(element).ok() };
            while let Some(child) = next {
                if *count >= MAX_NODES {
                    break;
                }
                if let Ok(value) = read_element(&child, walker, depth + 1, count) {
                    children.push(value);
                }
                // SAFETY: as above.
                next = unsafe { walker.GetNextSiblingElement(&child).ok() };
            }
        }
        Ok(node(
            &Facts {
                control_type,
                name: &name,
                is_password,
                enabled,
                focused,
                offscreen,
                rect,
            },
            children,
        ))
    }

    /// Reads the tree under one top-level window. Call it from a thread that may initialise COM.
    pub fn read_window(hwnd: isize) -> Result<Value, String> {
        // SAFETY: COM initialisation and creation of the automation object; an already-initialised thread is fine.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("UI Automation unavailable: {e}"))?;
            let root = automation
                .ElementFromHandle(HWND(hwnd as *mut _))
                .map_err(|e| format!("Window not readable: {e}"))?;
            let walker = automation
                .ControlViewWalker()
                .map_err(|e| format!("Tree walker unavailable: {e}"))?;
            let mut count = 0;
            read_element(&root, &walker, 0, &mut count)
                .map_err(|e| format!("Tree not readable: {e}"))
        }
    }
}

#[cfg(windows)]
pub use reader::read_window;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_are_plain_words_and_unknown_ids_are_unknown() {
        assert_eq!(role_for(50000), "button");
        assert_eq!(role_for(50004), "edit");
        assert_eq!(role_for(50032), "window");
        assert_eq!(role_for(1), "unknown");
        assert_eq!(role_for(-5), "unknown");
        // Every role word fits what the other side accepts: lower-case letters, digits, up to 32 characters.
        for id in 50000..=50038 {
            let role = role_for(id);
            assert!(role.chars().next().unwrap().is_ascii_lowercase(), "{id}");
            assert!(
                role.len() <= 32
                    && role
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
                "{id}"
            );
            assert_ne!(role, "unknown", "{id}");
        }
    }

    #[test]
    fn a_password_field_keeps_its_role_and_no_name() {
        let value = node(
            &Facts {
                control_type: 50004,
                name: "Account password",
                is_password: true,
                enabled: true,
                focused: true,
                offscreen: false,
                rect: (0, 0, 10, 10),
            },
            vec![],
        );
        assert_eq!(value["role"], "password");
        assert_eq!(value["protected"], true);
        assert!(value.get("name").is_none());
        assert!(!value.to_string().contains("Account password"));
    }

    #[test]
    fn states_bounds_and_name_are_reported_and_a_long_name_is_cut() {
        let long = "n".repeat(500);
        let value = node(
            &Facts {
                control_type: 50000,
                name: &long,
                is_password: false,
                enabled: false,
                focused: true,
                offscreen: true,
                rect: (10, 20, 110, 50),
            },
            vec![],
        );
        assert_eq!(value["role"], "button");
        assert_eq!(value["states"], json!(["disabled", "focused", "offscreen"]));
        assert_eq!(
            value["bounds"],
            json!({"x": 10, "y": 20, "width": 100, "height": 30})
        );
        assert_eq!(value["name"].as_str().unwrap().chars().count(), MAX_NAME);
        // An inverted box never gives a negative size.
        let odd = node(
            &Facts {
                control_type: 50000,
                name: "",
                is_password: false,
                enabled: true,
                focused: false,
                offscreen: false,
                rect: (50, 50, 10, 10),
            },
            vec![],
        );
        assert_eq!(odd["bounds"]["width"], 0);
        assert_eq!(odd["bounds"]["height"], 0);
        assert!(odd.get("name").is_none());
    }

    /// Reads the real taskbar through UI Automation. It needs a signed-in desktop, so it is run by hand:
    /// `cargo test -p beacon-remote-session taskbar -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore = "needs a desktop with a taskbar"]
    fn the_taskbar_reads_as_a_bounded_tree() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
        // SAFETY: looks a top-level window up by its class name.
        let hwnd = unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.expect("no taskbar window");
        let tree = read_window(hwnd.0 as isize).expect("tree");
        fn count(value: &Value) -> usize {
            1 + value["children"]
                .as_array()
                .map(|c| c.iter().map(count).sum())
                .unwrap_or(0)
        }
        fn has_role(value: &Value, role: &str) -> bool {
            value["role"] == role
                || value["children"]
                    .as_array()
                    .is_some_and(|c| c.iter().any(|v| has_role(v, role)))
        }
        let total = count(&tree);
        assert!((2..=MAX_NODES).contains(&total), "{total} nodes");
        assert!(has_role(&tree, "button"), "the taskbar has buttons");
        assert!(tree["bounds"]["width"].as_i64().unwrap() > 0);
        println!("taskbar nodes: {total}");
        // Lets a person feed the real tree to the other side's snapshot code: set BEACON_UI_TREE_DUMP to a file path.
        if let Ok(path) = std::env::var("BEACON_UI_TREE_DUMP") {
            std::fs::write(path, tree.to_string()).expect("dump");
        }
    }
}
