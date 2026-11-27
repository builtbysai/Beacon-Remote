//! Submits one raw print job to a printer the owner selected (P2-1). Every check happens before the spooler is
//! touched: the printer must be installed here and the job must be non-empty and within the size limit. The job
//! is sent as RAW data, so the printer driver is not asked to interpret it. Nothing in the tests calls this
//! function against a real printer.

use crate::print_jobs::State;

/// Largest job the spooler adapter accepts, matching the job lifecycle's default bound.
pub const MAX_JOB_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum SubmitError {
    NotInstalled,
    Empty,
    TooLarge,
    Spooler(&'static str),
}

/// Checks that need no spooler: a selected, installed printer name and a bounded, non-empty job.
pub fn check(installed: &[String], printer: &str, bytes: &[u8]) -> Result<(), SubmitError> {
    if !installed.iter().any(|name| name == printer) {
        return Err(SubmitError::NotInstalled);
    }
    if bytes.is_empty() {
        return Err(SubmitError::Empty);
    }
    if bytes.len() > MAX_JOB_BYTES {
        return Err(SubmitError::TooLarge);
    }
    Ok(())
}

#[cfg(windows)]
pub fn submit(printer: &str, document: &str, bytes: &[u8]) -> Result<State, SubmitError> {
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };
    let installed = crate::printers::installed().map_err(|_| SubmitError::Spooler("list"))?;
    check(&installed, printer, bytes)?;
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let printer_name = wide(printer);
    let mut handle = windows_sys::Win32::Graphics::Printing::PRINTER_HANDLE::default();
    if unsafe { OpenPrinterW(printer_name.as_ptr(), &mut handle, std::ptr::null()) } == 0 {
        return Err(SubmitError::Spooler("open"));
    }
    let mut doc_name = wide(document);
    let mut datatype = wide("RAW");
    let info = DOC_INFO_1W {
        pDocName: doc_name.as_mut_ptr(),
        pOutputFile: std::ptr::null_mut(),
        pDatatype: datatype.as_mut_ptr(),
    };
    let result = (|| {
        if unsafe { StartDocPrinterW(handle, 1, &info) } == 0 {
            return Err(SubmitError::Spooler("start"));
        }
        if unsafe { StartPagePrinter(handle) } == 0 {
            unsafe { EndDocPrinter(handle) };
            return Err(SubmitError::Spooler("page"));
        }
        let mut written: u32 = 0;
        let ok = unsafe {
            WritePrinter(
                handle,
                bytes.as_ptr().cast(),
                bytes.len() as u32,
                &mut written,
            )
        };
        unsafe {
            EndPagePrinter(handle);
            EndDocPrinter(handle);
        }
        if ok == 0 || written as usize != bytes.len() {
            return Err(SubmitError::Spooler("write"));
        }
        Ok(State::Done)
    })();
    unsafe { ClosePrinter(handle) };
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_printer_that_is_not_installed_is_refused_before_the_spooler() {
        let installed = vec!["Office Laser".to_string()];
        assert_eq!(
            check(&installed, "Unknown", b"x"),
            Err(SubmitError::NotInstalled)
        );
    }

    #[test]
    fn empty_and_oversized_jobs_are_refused() {
        let installed = vec!["Office Laser".to_string()];
        assert_eq!(
            check(&installed, "Office Laser", b""),
            Err(SubmitError::Empty)
        );
        let big = vec![0u8; MAX_JOB_BYTES + 1];
        assert_eq!(
            check(&installed, "Office Laser", &big),
            Err(SubmitError::TooLarge)
        );
        assert_eq!(check(&installed, "Office Laser", b"%PDF-1.4"), Ok(()));
    }
}
