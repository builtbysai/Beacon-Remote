//! The one place a connection request and a running session are shown (ADR 0059). It is a page inside the host
//! window, driven entirely by what the capture helper reports through `session_hub`. It only ever sends answers and
//! commands; the helper decides whether they still apply.
//!
//! Decline is the default (focused, and the only default button). Stop is always on screen while sharing and is
//! never behind another click.
#![allow(clippy::missing_safety_doc)]
use crate::{
    native_ui as ui,
    session_hub::{self, View},
};
use beacon_remote_session::ui_protocol::{PromptKind, ToHelper};
use std::{
    io,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
        DeleteObject, EndPaint, FillRect, InvalidateRect, SelectObject, PAINTSTRUCT, SRCCOPY,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::{DRAWITEMSTRUCT, ODS_DISABLED, ODS_FOCUS, ODS_SELECTED},
        Input::KeyboardAndMouse::SetFocus,
        WindowsAndMessaging::*,
    },
};

pub const BACK_HEIGHT_REQUEST: i32 = 480;
pub const BACK_HEIGHT_SHARING: i32 = 560;
const CLASS: &str = "BeaconRemoteSessionPage";

const DECLINE: i32 = 401;
const ALLOW: i32 = 402;
const STOP: i32 = 403;
const PAUSE: i32 = 404;
const MUTE: i32 = 405;
const SEND: i32 = 406;
const REVOKE: i32 = 407;
const CK_FILES: i32 = 411;
const CK_RECORD: i32 = 412;
const CK_AUDIO: i32 = 413;
const CARD_VIEW: i32 = 421;
const CARD_CONTROL: i32 = 422;
const ALL: [i32; 12] = [
    DECLINE,
    ALLOW,
    STOP,
    PAUSE,
    MUTE,
    SEND,
    REVOKE,
    CK_FILES,
    CK_RECORD,
    CK_AUDIO,
    CARD_VIEW,
    CARD_CONTROL,
];

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

struct Page {
    palette: ui::Palette,
    scale: f32,
    view: View,
    // What the person has ticked on the first request.
    control: bool,
    files: bool,
    recording: bool,
    audio: bool,
    prompt_id: u32,
}

/// The window height the current view needs, in device-independent pixels.
pub fn height(view: &View) -> i32 {
    match &view.prompt {
        Some((prompt, _)) if prompt.kind == PromptKind::First => BACK_HEIGHT_REQUEST,
        _ => BACK_HEIGHT_SHARING,
    }
}

/// Creates the page over `client` (the host window's client area).
pub unsafe fn embed(parent: HWND, client: RECT, scale: f32) -> Result<HWND, io::Error> {
    let instance = GetModuleHandleW(null());
    let class = wide(CLASS);
    let description = WNDCLASSW {
        lpfnWndProc: Some(procedure),
        hInstance: instance,
        lpszClassName: class.as_ptr(),
        hCursor: LoadCursorW(null_mut(), IDC_ARROW),
        ..std::mem::zeroed()
    };
    RegisterClassW(&description);
    let page = Box::into_raw(Box::new(Page {
        palette: ui::palette(),
        scale,
        view: session_hub::view(),
        control: false,
        files: false,
        recording: false,
        audio: false,
        prompt_id: 0,
    }));
    let window = CreateWindowExW(
        0,
        class.as_ptr(),
        wide("Beacon Remote session").as_ptr(),
        WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
        0,
        0,
        client.right,
        client.bottom,
        parent,
        null_mut(),
        instance,
        page.cast(),
    );
    if window.is_null() {
        drop(Box::from_raw(page));
        return Err(io::Error::last_os_error());
    }
    Ok(window)
}

unsafe fn px(page: &Page, value: i32) -> i32 {
    (value as f32 * page.scale).round() as i32
}

unsafe fn make_controls(window: HWND, page: &Page) {
    let instance = GetModuleHandleW(null());
    for id in ALL {
        let label = match id {
            DECLINE => "Decline",
            ALLOW => "Allow once",
            STOP => "Stop sharing",
            PAUSE => "Pause",
            MUTE => "Mute sound",
            SEND => "Send a file…",
            REVOKE => "Turn off files",
            CK_FILES => "Let them send and receive files",
            CK_RECORD => "Let them record this session",
            CK_AUDIO => "Let them hear this computer's sound",
            CARD_VIEW => "View only",
            _ => "View and control",
        };
        CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide(label).as_ptr(),
            WS_CHILD | WS_TABSTOP | BS_OWNERDRAW as u32,
            0,
            0,
            px(page, 100),
            px(page, 30),
            window,
            id as usize as _,
            instance,
            null(),
        );
    }
}

/// Places and shows the controls this view needs, and hides the rest.
unsafe fn arrange(window: HWND, page: &mut Page) {
    let view = &page.view;
    let first = view
        .prompt
        .as_ref()
        .filter(|(p, _)| p.kind == PromptKind::First);
    let more = view
        .prompt
        .as_ref()
        .filter(|(p, _)| p.kind == PromptKind::More);
    let session = view.session.as_ref();
    if let Some((prompt, _)) = &view.prompt {
        if prompt.id != page.prompt_id {
            page.prompt_id = prompt.id;
            page.control = false;
            page.files = false;
            page.recording = false;
            page.audio = false;
        }
    }
    let place = |id: i32, x: i32, y: i32, w: i32, h: i32, shown: bool| {
        let control = GetDlgItem(window, id);
        if control.is_null() {
            return;
        }
        MoveWindow(control, px(page, x), px(page, y), px(page, w), px(page, h), 1);
        ShowWindow(control, if shown { SW_SHOW } else { SW_HIDE });
    };
    let asked_control = first.is_some_and(|(p, _)| p.control);
    place(CARD_VIEW, 28, 178, 226, 56, asked_control);
    place(CARD_CONTROL, 266, 178, 226, 56, asked_control);
    let top = if asked_control { 250 } else { 186 };
    place(CK_FILES, 28, top, 464, 26, first.is_some());
    place(CK_RECORD, 28, top + 30, 464, 26, first.is_some());
    place(CK_AUDIO, 28, top + 60, 464, 26, first.is_some());
    place(DECLINE, 28, if first.is_some() { 400 } else { 462 }, 226, 44, first.is_some() || more.is_some());
    place(ALLOW, 266, if first.is_some() { 400 } else { 462 }, 226, 44, first.is_some() || more.is_some());
    let sharing = first.is_none() && session.is_some();
    place(STOP, 28, 204, 464, 52, sharing);
    place(PAUSE, 28, 270, 226, 40, sharing);
    place(MUTE, 266, 270, 226, 40, sharing && session.is_some_and(|s| s.audio));
    place(SEND, 28, 320, 226, 40, sharing && session.is_some_and(|s| s.files && s.connected && !s.paused));
    place(REVOKE, 266, 320, 226, 40, sharing && session.is_some_and(|s| s.files || s.recording));
    if let Some(session) = session {
        SetWindowTextW(
            GetDlgItem(window, PAUSE),
            wide(if session.paused { "Resume" } else { "Pause" }).as_ptr(),
        );
        SetWindowTextW(
            GetDlgItem(window, MUTE),
            wide(if session.muted { "Unmute sound" } else { "Mute sound" }).as_ptr(),
        );
        SetWindowTextW(
            GetDlgItem(window, REVOKE),
            wide(if session.files && session.recording {
                "Turn off files and recording"
            } else if session.files {
                "Turn off files"
            } else {
                "Turn off recording"
            })
            .as_ptr(),
        );
    }
}

fn clock(milliseconds: u64) -> String {
    let seconds = milliseconds.div_ceil(1000);
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

unsafe fn paint(window: HWND, page: &Page) {
    let mut ps: PAINTSTRUCT = std::mem::zeroed();
    let hdc = BeginPaint(window, &mut ps);
    let mut client = RECT::default();
    GetClientRect(window, &mut client);
    let (w, h) = (client.right, client.bottom);
    let buffer = CreateCompatibleDC(hdc);
    let bitmap = CreateCompatibleBitmap(hdc, w, h);
    let old = SelectObject(buffer, bitmap);
    let p = &page.palette;
    let brush = CreateSolidBrush(ui::colorref(p.window));
    FillRect(buffer, &RECT { left: 0, top: 0, right: w, bottom: h }, brush);
    DeleteObject(brush);
    if let Some(canvas) = ui::Canvas::new(buffer, page.scale) {
        let view = &page.view;
        let first = view.prompt.as_ref().filter(|(p, _)| p.kind == PromptKind::First);
        let more = view.prompt.as_ref().filter(|(p, _)| p.kind == PromptKind::More);
        if let Some((prompt, _)) = first {
            ui::mark(&canvas, p, (28.0, 14.0, 46.0), ui::Mood::Wow, ui::SUN);
            canvas.text(
                &format!("{} wants to view your screen", prompt.controller),
                (86.0, 14.0, 406.0, 46.0),
                17.0,
                700,
                p.strong,
                ui::Align::Left,
                true,
            );
            canvas.fill(28.0, 92.0, 464.0, 72.0, 16.0, p.surface);
            canvas.stroke(28.0, 92.0, 464.0, 72.0, 16.0, p.line, 1.0);
            canvas.text(&prompt.display, (44.0, 100.0, 432.0, 28.0), 14.0, 600, p.strong, ui::Align::Left, true);
            let lasts = if prompt.unlimited { "Until you stop it" } else { "For a limited time" };
            canvas.text(
                &format!("Session {} · {lasts}", prompt.session),
                (44.0, 128.0, 432.0, 28.0),
                12.5,
                400,
                p.muted,
                ui::Align::Left,
                true,
            );
            let left = session_hub::time_left(first.unwrap());
            canvas.text(
                &format!(
                    "No answer in {} declines this request. Nothing is shared until you allow it.",
                    clock(left.as_millis() as u64)
                ),
                (28.0, 352.0, 464.0, 38.0),
                12.5,
                400,
                p.muted,
                ui::Align::Left,
                false,
            );
        } else if let Some(session) = &view.session {
            let (mood, body) = if session.paused {
                (ui::Mood::Asleep, ui::SLEEP)
            } else {
                (ui::Mood::Awake, ui::MINT)
            };
            ui::mark(&canvas, p, (28.0, 14.0, 46.0), mood, body);
            canvas.text(
                if session.paused { "Sharing is paused" } else { "Your screen is being shared" },
                (86.0, 14.0, 406.0, 28.0),
                17.0,
                700,
                p.strong,
                ui::Align::Left,
                true,
            );
            canvas.text(
                &session.controller,
                (86.0, 42.0, 406.0, 22.0),
                13.0,
                400,
                p.muted,
                ui::Align::Left,
                true,
            );
            canvas.fill(28.0, 92.0, 464.0, 96.0, 16.0, p.surface);
            canvas.stroke(28.0, 92.0, 464.0, 96.0, 16.0, p.line, 1.0);
            let access = if session.paused {
                "Screen and input are off"
            } else if !session.connected {
                "Waiting for the viewer to connect"
            } else if session.control {
                "Mouse and keyboard control"
            } else {
                "View only"
            };
            canvas.text(access, (44.0, 100.0, 432.0, 28.0), 14.0, 600, p.strong, ui::Align::Left, true);
            let mut extras = Vec::new();
            if session.files {
                extras.push("files");
            }
            if session.recording {
                extras.push(if session.recording_active { "recording now" } else { "recording allowed" });
            }
            if session.audio && !session.muted {
                extras.push("sound");
            }
            let line = format!(
                "Session {} · {}",
                session.session,
                match session.remaining_ms {
                    Some(ms) => format!("{} left", clock(ms)),
                    None => "until you stop it".into(),
                }
            );
            canvas.text(&line, (44.0, 128.0, 432.0, 24.0), 12.5, 400, p.muted, ui::Align::Left, true);
            canvas.text(
                &if !session.note.is_empty() {
                    session.note.clone()
                } else if extras.is_empty() {
                    "No extra access".to_owned()
                } else {
                    format!("Also allowed: {}", extras.join(", "))
                },
                (44.0, 154.0, 432.0, 24.0),
                12.5,
                400,
                p.muted,
                ui::Align::Left,
                true,
            );
        }
        if let Some((prompt, _)) = more {
            canvas.fill(28.0, 376.0, 464.0, 72.0, 16.0, p.warn_soft);
            canvas.stroke(28.0, 376.0, 464.0, 72.0, 16.0, p.warn_line, 1.0);
            canvas.text(
                &format!("{} asks for more access", prompt.controller),
                (44.0, 382.0, 432.0, 28.0),
                14.0,
                700,
                p.strong,
                ui::Align::Left,
                true,
            );
            canvas.text(&prompt.detail, (44.0, 410.0, 432.0, 30.0), 12.5, 400, p.text, ui::Align::Left, true);
        }
    }
    BitBlt(hdc, 0, 0, w, h, buffer, 0, 0, SRCCOPY);
    SelectObject(buffer, old);
    DeleteObject(bitmap);
    DeleteDC(buffer);
    EndPaint(window, &ps);
}

unsafe fn draw_item(page: &Page, item: &DRAWITEMSTRUCT) {
    let w = (item.rcItem.right - item.rcItem.left) as f32 / page.scale;
    let h = (item.rcItem.bottom - item.rcItem.top) as f32 / page.scale;
    let p = &page.palette;
    let brush = CreateSolidBrush(ui::colorref(p.window));
    FillRect(item.hDC, &item.rcItem, brush);
    DeleteObject(brush);
    let Some(canvas) = ui::Canvas::new(item.hDC, page.scale) else {
        return;
    };
    let mut label = [0u16; 128];
    let length = GetWindowTextW(item.hwndItem, label.as_mut_ptr(), label.len() as i32).max(0);
    let label = String::from_utf16_lossy(&label[..length as usize]);
    let flags = ui::State {
        hot: false,
        pressed: item.itemState & ODS_SELECTED != 0,
        focused: item.itemState & ODS_FOCUS != 0,
        disabled: item.itemState & ODS_DISABLED != 0,
    };
    match item.CtlID as i32 {
        CK_FILES => ui::checkbox(&canvas, p, (w, h), &label, page.files, flags),
        CK_RECORD => ui::checkbox(&canvas, p, (w, h), &label, page.recording, flags),
        CK_AUDIO => ui::checkbox(&canvas, p, (w, h), &label, page.audio, flags),
        CARD_VIEW => ui::radio_card(
            &canvas,
            p,
            (w, h),
            &label,
            "They see the screen only",
            !page.control,
            flags,
        ),
        CARD_CONTROL => ui::radio_card(
            &canvas,
            p,
            (w, h),
            &label,
            "They can also use mouse and keyboard",
            page.control,
            flags,
        ),
        id => ui::button(
            &canvas,
            p,
            (w, h),
            &label,
            match id {
                ALLOW => ui::Role::Primary,
                STOP => ui::Role::Danger,
                _ => ui::Role::Secondary,
            },
            flags,
        ),
    }
}

unsafe extern "system" fn procedure(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam as *const CREATESTRUCTW);
        SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
    }
    let page = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut Page;
    if page.is_null() {
        return DefWindowProcW(window, message, wparam, lparam);
    }
    match message {
        WM_CREATE => {
            make_controls(window, &*page);
            arrange(window, &mut *page);
            // A request starts with Decline focused; a running session has nothing focused that could end it.
            if (*page).view.prompt.is_some() {
                SetFocus(GetDlgItem(window, DECLINE));
            }
            SetTimer(window, 7, 200, None);
            return 0;
        }
        WM_ERASEBKGND => return 1,
        WM_PAINT => {
            paint(window, &*page);
            return 0;
        }
        WM_DRAWITEM => {
            draw_item(&*page, &*(lparam as *const DRAWITEMSTRUCT));
            return 1;
        }
        WM_TIMER => {
            (*page).view = session_hub::view();
            arrange(window, &mut *page);
            InvalidateRect(window, null(), 0);
            return 0;
        }
        WM_COMMAND if (wparam >> 16) == BN_CLICKED as usize => {
            let page = &mut *page;
            match (wparam & 0xffff) as i32 {
                CARD_VIEW => page.control = false,
                CARD_CONTROL => page.control = true,
                CK_FILES => page.files = !page.files,
                CK_RECORD => page.recording = !page.recording,
                CK_AUDIO => page.audio = !page.audio,
                DECLINE => {
                    if let Some((prompt, _)) = &page.view.prompt {
                        session_hub::answer(prompt.id, false, false, false, false, false);
                    }
                }
                ALLOW => {
                    if let Some((prompt, _)) = &page.view.prompt {
                        let first = prompt.kind == PromptKind::First;
                        session_hub::answer(
                            prompt.id,
                            true,
                            first && prompt.control && page.control,
                            first && page.files,
                            first && page.recording,
                            first && page.audio,
                        );
                    }
                }
                STOP => session_hub::send(&ToHelper::Stop),
                PAUSE => {
                    let on = !page.view.session.as_ref().is_some_and(|s| s.paused);
                    session_hub::send(&ToHelper::Pause { on });
                }
                MUTE => {
                    let on = !page.view.session.as_ref().is_some_and(|s| s.muted);
                    session_hub::send(&ToHelper::Mute { on });
                }
                REVOKE => session_hub::send(&ToHelper::RevokeExtras),
                SEND => {
                    if let Some(path) = choose_file(window) {
                        session_hub::send(&ToHelper::SendFile {
                            path: path.to_string_lossy().into_owned(),
                        });
                    }
                }
                _ => {}
            }
            InvalidateRect(window, null(), 0);
            return 0;
        }
        WM_DESTROY => {
            KillTimer(window, 7);
        }
        WM_NCDESTROY => {
            SetWindowLongPtrW(window, GWLP_USERDATA, 0);
            drop(Box::from_raw(page));
        }
        _ => {}
    }
    DefWindowProcW(window, message, wparam, lparam)
}

/// The file the person picks to send to the viewer. The helper checks again that sending is allowed.
unsafe fn choose_file(window: HWND) -> Option<std::path::PathBuf> {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_PATHMUSTEXIST,
        OPENFILENAMEW,
    };
    let mut buffer = vec![0u16; 32768];
    let title = wide("Choose a file to send");
    let mut dialog: OPENFILENAMEW = std::mem::zeroed();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.hwndOwner = window;
    dialog.lpstrFile = buffer.as_mut_ptr();
    dialog.nMaxFile = buffer.len() as u32;
    dialog.lpstrTitle = title.as_ptr();
    dialog.Flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY;
    if GetOpenFileNameW(&mut dialog) == 0 {
        return None;
    }
    let length = buffer.iter().position(|unit| *unit == 0)?;
    Some(std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length])))
}
