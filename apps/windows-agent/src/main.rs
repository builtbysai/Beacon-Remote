fn main() -> Result<(), beacon_remote_agent::HostError> {
    if !cfg!(windows) {
        return Err("Beacon Remote agent requires Windows".into());
    }
    beacon_remote_agent::cli()
}
