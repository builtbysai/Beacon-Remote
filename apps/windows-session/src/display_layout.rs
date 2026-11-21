//! Compares two snapshots of the monitor layout (P1-6 hotplug). A monitor added, removed, moved, resized or
//! rescaled changes what the viewer is looking at, so each change is reported and the session must refresh its
//! description before more input is mapped. This is pure: the caller takes the snapshots from Windows.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Monitor {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    /// Effective scale in percent (100 = 96 DPI).
    pub scale_percent: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Change {
    Added(String),
    Removed(String),
    Moved(String),
    Resized(String),
    Rescaled(String),
}

pub fn diff(before: &[Monitor], after: &[Monitor]) -> Vec<Change> {
    let mut changes = Vec::new();
    for old in before {
        match after.iter().find(|monitor| monitor.id == old.id) {
            None => changes.push(Change::Removed(old.id.clone())),
            Some(new) => {
                if (old.origin_x, old.origin_y) != (new.origin_x, new.origin_y) {
                    changes.push(Change::Moved(old.id.clone()));
                }
                if (old.width, old.height) != (new.width, new.height) {
                    changes.push(Change::Resized(old.id.clone()));
                }
                if old.scale_percent != new.scale_percent {
                    changes.push(Change::Rescaled(old.id.clone()));
                }
            }
        }
    }
    for new in after {
        if !before.iter().any(|monitor| monitor.id == new.id) {
            changes.push(Change::Added(new.id.clone()));
        }
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(id: &str, x: i32, width: u32, scale: u32) -> Monitor {
        Monitor {
            id: id.to_string(),
            width,
            height: 1080,
            origin_x: x,
            origin_y: 0,
            scale_percent: scale,
        }
    }

    #[test]
    fn an_unchanged_layout_reports_nothing() {
        let layout = vec![monitor("A", 0, 1920, 100), monitor("B", -1280, 1280, 125)];
        assert!(diff(&layout, &layout).is_empty());
    }

    #[test]
    fn plugging_unplugging_and_moving_each_report_once() {
        let before = vec![monitor("A", 0, 1920, 100)];
        let after = vec![monitor("A", 1920, 1920, 100), monitor("B", 0, 1280, 100)];
        assert_eq!(
            diff(&before, &after),
            vec![Change::Moved("A".into()), Change::Added("B".into())]
        );
        assert_eq!(
            diff(&after, &before),
            vec![Change::Moved("A".into()), Change::Removed("B".into())]
        );
    }

    #[test]
    fn a_resize_and_a_scale_change_are_distinct() {
        let before = vec![monitor("A", 0, 1920, 100)];
        let resized = vec![monitor("A", 0, 2560, 100)];
        let rescaled = vec![monitor("A", 0, 1920, 150)];
        assert_eq!(diff(&before, &resized), vec![Change::Resized("A".into())]);
        assert_eq!(diff(&before, &rescaled), vec![Change::Rescaled("A".into())]);
    }
}
