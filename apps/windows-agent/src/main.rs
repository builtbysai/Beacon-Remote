fn main() -> Result<(), beacon_remote_agent::HostError> {
    #[cfg(windows)]
    if let Some(result) =
        beacon_remote_agent::availability::command(&std::env::args().collect::<Vec<_>>())
    {
        return result;
    }
    if !cfg!(windows) {
        return Err("Beacon Remote agent requires Windows".into());
    }
    beacon_remote_agent::cli()
}
