//! Wake-on-LAN (ADR 0042): what this computer tells the server about its network cards, and sending the magic packet
//! when the server asks this computer to wake a neighbour. Nothing here opens a listening port.
use sha2::{Digest, Sha256};

/// A magic packet: six 0xFF bytes then the hardware address sixteen times. `mac` is "AA:BB:CC:DD:EE:FF".
pub fn magic_packet(mac: &str) -> Option<Vec<u8>> {
    let bytes: Vec<u8> = mac
        .split(':')
        .map(|part| u8::from_str_radix(part, 16).ok())
        .collect::<Option<_>>()?;
    if bytes.len() != 6 || mac.len() != 17 {
        return None;
    }
    let mut packet = vec![0xFF; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&bytes);
    }
    Some(packet)
}

/// Broadcasts a magic packet on this computer's local network. The request came from the signed-in server for one of
/// this account's own computers; the packet carries nothing but the hardware address.
pub fn send_magic(mac: &str) -> bool {
    let Some(packet) = magic_packet(mac) else {
        return false;
    };
    let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") else {
        return false;
    };
    if socket.set_broadcast(true).is_err() {
        return false;
    }
    // Port 9 (discard) is the usual one; some network cards listen on 7.
    [9u16, 7]
        .iter()
        .filter(|port| socket.send_to(&packet, ("255.255.255.255", **port)).is_ok())
        .count()
        > 0
}

/// A name for a local network that two computers on it will agree on without revealing its addresses.
pub fn lan_name(gateway: &str, network: &str, prefix: u8) -> String {
    let digest = Sha256::digest(format!("{gateway}|{network}/{prefix}").as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// This computer's wired and wireless hardware addresses (at most four) and the name of the network it is on.
#[cfg(windows)]
pub fn info() -> Option<(Vec<String>, String)> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST,
        GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};
    const IF_OPER_UP: i32 = 1;
    const ETHERNET: u32 = 6;
    const WIFI: u32 = 71;
    let flags = GAA_FLAG_INCLUDE_GATEWAYS
        | GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size = 16 * 1024u32;
    let mut buffer: Vec<u8> = Vec::new();
    for _ in 0..3 {
        buffer = vec![0u8; size as usize];
        let status = unsafe {
            GetAdaptersAddresses(
                AF_INET as u32,
                flags,
                std::ptr::null(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        match status {
            0 => break,
            111 => continue, // ERROR_BUFFER_OVERFLOW: `size` now holds what is needed
            _ => return None,
        }
    }
    let mut macs: Vec<String> = Vec::new();
    let mut lan: Option<String> = None;
    let mut adapter = buffer.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
    while !adapter.is_null() {
        let current = unsafe { &*adapter };
        if current.OperStatus == IF_OPER_UP
            && (current.IfType == ETHERNET || current.IfType == WIFI)
            && current.PhysicalAddressLength == 6
        {
            let mac = current.PhysicalAddress[..6]
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect::<Vec<_>>()
                .join(":");
            if macs.len() < 4 && !macs.contains(&mac) {
                macs.push(mac);
            }
            if lan.is_none() && !current.FirstGatewayAddress.is_null() {
                let gateway = unsafe { (*current.FirstGatewayAddress).Address.lpSockaddr };
                let unicast = current.FirstUnicastAddress;
                if !gateway.is_null() && !unicast.is_null() {
                    let gateway = unsafe { &*(gateway as *const SOCKADDR_IN) };
                    let own = unsafe { &*((*unicast).Address.lpSockaddr as *const SOCKADDR_IN) };
                    let prefix = unsafe { (*unicast).OnLinkPrefixLength };
                    let gateway_ip = std::net::Ipv4Addr::from(u32::from_be(unsafe {
                        gateway.sin_addr.S_un.S_addr
                    }));
                    let own_ip = u32::from_be(unsafe { own.sin_addr.S_un.S_addr });
                    let mask = if prefix == 0 {
                        0
                    } else {
                        u32::MAX << (32 - u32::from(prefix.min(32)))
                    };
                    lan = Some(lan_name(
                        &gateway_ip.to_string(),
                        &std::net::Ipv4Addr::from(own_ip & mask).to_string(),
                        prefix,
                    ));
                }
            }
        }
        adapter = current.Next;
    }
    match (macs.is_empty(), lan) {
        (false, Some(lan)) => Some((macs, lan)),
        _ => None,
    }
}
#[cfg(not(windows))]
pub fn info() -> Option<(Vec<String>, String)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_magic_packet_is_six_ff_then_the_address_sixteen_times() {
        let packet = magic_packet("AA:BB:CC:DD:EE:01").unwrap();
        assert_eq!(packet.len(), 102);
        assert!(packet[..6].iter().all(|byte| *byte == 0xFF));
        assert!(packet[6..]
            .chunks(6)
            .all(|chunk| chunk == [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01]));
        for bad in [
            "",
            "AA:BB",
            "AA:BB:CC:DD:EE:0G",
            "AA-BB-CC-DD-EE-01",
            "AA:BB:CC:DD:EE:01:02",
        ] {
            assert!(magic_packet(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn computers_on_one_network_agree_on_its_name_and_others_do_not() {
        let home = lan_name("192.168.1.1", "192.168.1.0", 24);
        assert_eq!(home, lan_name("192.168.1.1", "192.168.1.0", 24));
        assert_ne!(home, lan_name("192.168.1.1", "192.168.2.0", 24));
        assert_eq!(home.len(), 16);
    }
}
