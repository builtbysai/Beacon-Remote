//! The forwarding boundary for P2-3. A request must first pass the allow list (`peripheral_policy`); only then does
//! it reach a transport. There is no transport yet: `NoTransport` refuses everything, so an allowed device is still
//! not forwarded. A real transport is added behind the `Transport` trait once it can be tested with the device.

use crate::peripheral_policy::{AllowList, Decision, Descriptor};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Refused by the allow list before any transport was involved.
    Denied(&'static str),
    /// Allowed by policy, but no transport exists to carry it.
    NoTransport,
}

pub trait Transport {
    fn forward(&mut self, device: &Descriptor) -> Result<(), &'static str>;
}

/// The transport that exists today: it carries nothing.
pub struct NoTransport;

impl Transport for NoTransport {
    fn forward(&mut self, _device: &Descriptor) -> Result<(), &'static str> {
        Err("no transport is available")
    }
}

/// Checks policy first, then asks the transport. A denied device never reaches the transport.
pub fn request<T: Transport>(list: &AllowList, transport: &mut T, device: &Descriptor) -> Outcome {
    match list.decide(device) {
        Decision::Deny(reason) => Outcome::Denied(reason),
        Decision::Allow(_) => match transport.forward(device) {
            Ok(()) => Outcome::NoTransport,
            Err(_) => Outcome::NoTransport,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peripheral_policy::Category;

    struct Recording(usize);
    impl Transport for Recording {
        fn forward(&mut self, _device: &Descriptor) -> Result<(), &'static str> {
            self.0 += 1;
            Ok(())
        }
    }

    fn reader() -> Descriptor {
        Descriptor {
            vendor: 0x1050,
            product: 0x0407,
            interface_class: 0x0B,
            usage_page: None,
        }
    }

    #[test]
    fn a_denied_device_never_reaches_the_transport() {
        let mut transport = Recording(0);
        let outcome = request(&AllowList::default(), &mut transport, &reader());
        assert!(matches!(outcome, Outcome::Denied(_)));
        assert_eq!(transport.0, 0);
    }

    #[test]
    fn an_allowed_device_reaches_the_transport_and_nothing_pretends_it_forwarded() {
        let list = AllowList {
            entries: vec![(Category::SmartCard, 0x1050, 0x0407)],
        };
        let mut transport = Recording(0);
        assert_eq!(
            request(&list, &mut transport, &reader()),
            Outcome::NoTransport
        );
        assert_eq!(transport.0, 1);
        assert_eq!(
            request(&list, &mut NoTransport, &reader()),
            Outcome::NoTransport
        );
    }
}
