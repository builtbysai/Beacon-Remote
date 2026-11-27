//! Allow-list policy for specialist peripherals (P2-3). This decides only whether a device may ever be offered
//! to a remote session. It does not open, claim or forward any USB device; arbitrary passthrough is refused by
//! default, and a device is allowed only by a listed category and an exact vendor/product pair the owner
//! configured. Transport comes later, behind this policy.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    /// Smart-card readers (USB CCID class 0x0B).
    SmartCard,
    /// FIDO2/U2F security keys (HID usage page 0xF1D0).
    Authenticator,
    /// USB-serial adapters, the kind used for COM ports.
    SerialAdapter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow(Category),
    Deny(&'static str),
}

/// What is known about a USB device from its descriptors, without opening it.
#[derive(Clone, Copy, Debug)]
pub struct Descriptor {
    pub vendor: u16,
    pub product: u16,
    /// The interface class of the first interface (0x0B smart card, 0x03 HID, 0xFF vendor).
    pub interface_class: u8,
    /// The HID usage page of the first top-level collection, when the device reports one.
    pub usage_page: Option<u16>,
}

const CLASS_SMART_CARD: u8 = 0x0B;
const CLASS_HID: u8 = 0x03;
const USAGE_FIDO: u16 = 0xF1D0;

/// Exact vendor/product pairs the owner allowed for each category. Empty by default: nothing is allowed until
/// the owner lists a device.
#[derive(Clone, Debug, Default)]
pub struct AllowList {
    pub entries: Vec<(Category, u16, u16)>,
}

impl AllowList {
    pub fn decide(&self, device: &Descriptor) -> Decision {
        let category = if device.interface_class == CLASS_SMART_CARD {
            Category::SmartCard
        } else if device.interface_class == CLASS_HID && device.usage_page == Some(USAGE_FIDO) {
            Category::Authenticator
        } else if device.interface_class == 0xFF
            && self.allows_by_pair(device, Category::SerialAdapter)
        {
            // Vendor-specific serial bridges are identified only by the owner's exact entry.
            Category::SerialAdapter
        } else {
            return Decision::Deny("not a supported peripheral category");
        };
        if self.allows_by_pair(device, category) {
            Decision::Allow(category)
        } else {
            Decision::Deny("not on the owner's allow list")
        }
    }

    fn allows_by_pair(&self, device: &Descriptor, category: Category) -> bool {
        self.entries
            .iter()
            .any(|(c, v, p)| *c == category && *v == device.vendor && *p == device.product)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(interface_class: u8, usage_page: Option<u16>) -> Descriptor {
        Descriptor {
            vendor: 0x1050,
            product: 0x0407,
            interface_class,
            usage_page,
        }
    }

    #[test]
    fn nothing_is_allowed_until_the_owner_lists_it() {
        let list = AllowList::default();
        assert_eq!(
            list.decide(&device(CLASS_SMART_CARD, None)),
            Decision::Deny("not on the owner's allow list")
        );
    }

    #[test]
    fn a_listed_smart_card_reader_is_allowed_only_by_its_exact_pair() {
        let list = AllowList {
            entries: vec![(Category::SmartCard, 0x1050, 0x0407)],
        };
        assert_eq!(
            list.decide(&device(CLASS_SMART_CARD, None)),
            Decision::Allow(Category::SmartCard)
        );
        let other_product = Descriptor {
            product: 0x0408,
            ..device(CLASS_SMART_CARD, None)
        };
        assert!(matches!(list.decide(&other_product), Decision::Deny(_)));
    }

    #[test]
    fn a_security_key_is_recognised_by_its_fido_usage_page() {
        let list = AllowList {
            entries: vec![(Category::Authenticator, 0x1050, 0x0407)],
        };
        assert_eq!(
            list.decide(&device(CLASS_HID, Some(USAGE_FIDO))),
            Decision::Allow(Category::Authenticator)
        );
        // An ordinary keyboard or mouse is never a security key, even when listed by pair.
        assert!(matches!(
            list.decide(&device(CLASS_HID, Some(0x0001))),
            Decision::Deny(_)
        ));
    }

    #[test]
    fn unknown_vendor_devices_are_never_passed_through() {
        let list = AllowList {
            entries: vec![(Category::SerialAdapter, 0x1050, 0x0407)],
        };
        // A vendor-specific device is allowed only when its exact pair is listed as a serial adapter.
        assert!(matches!(
            list.decide(&device(0xFF, None)),
            Decision::Allow(Category::SerialAdapter)
        ));
        let unlisted = AllowList::default();
        assert!(matches!(
            unlisted.decide(&device(0xFF, None)),
            Decision::Deny(_)
        ));
        assert!(matches!(
            list.decide(&device(0x08, None)),
            Decision::Deny("not a supported peripheral category")
        ));
    }
}
